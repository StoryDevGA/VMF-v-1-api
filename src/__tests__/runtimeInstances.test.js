import { describe, test, expect, beforeAll, beforeEach, jest } from '@jest/globals'
import zlib from 'node:zlib'

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET =
    'test-jwt-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.JWT_REFRESH_SECRET =
    'test-jwt-refresh-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.MONGODB_URI = 'mongodb://localhost:27017/vmf_test'
  process.env.REDIS_URL = 'redis://localhost:6379'
})

const CUSTOMER_ADMIN_ID = '507f1f77bcf86cd799439012'
const SUPER_ADMIN_ID = '507f1f77bcf86cd799439013'
const REGULAR_USER_ID = '507f1f77bcf86cd799439014'
const CUSTOMER_ID = '607f1f77bcf86cd799439022'
const OTHER_CUSTOMER_ID = '607f1f77bcf86cd799439023'
const TENANT_ID = '707f1f77bcf86cd799439033'
const OTHER_TENANT_ID = '707f1f77bcf86cd799439034'
const FRAMEWORK_PACKAGE_ID = '927f1f77bcf86cd799439099'
const RUNTIME_INSTANCE_ID = 'a27f1f77bcf86cd799439111'
const UI_CONTRACT_KEY = 'vmf-cli-ui-contract'
const originalFetch = globalThis.fetch
const originalDiscoveryDnsLookup = globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__

const escapeDocxXmlText = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')

const buildDocxBufferWithDataDescriptor = (documentText) => {
  const fileNameBuffer = Buffer.from('word/document.xml', 'utf8')
  const xmlBuffer = Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>${escapeDocxXmlText(documentText)}</w:t></w:r></w:p>
      </w:body>
    </w:document>`, 'utf8')
  const compressedData = zlib.deflateRawSync(xmlBuffer)
  const localHeader = Buffer.alloc(30)
  localHeader.writeUInt32LE(0x04034b50, 0)
  localHeader.writeUInt16LE(20, 4)
  localHeader.writeUInt16LE(0x08, 6)
  localHeader.writeUInt16LE(8, 8)
  localHeader.writeUInt16LE(0, 10)
  localHeader.writeUInt16LE(0, 12)
  localHeader.writeUInt32LE(0, 14)
  localHeader.writeUInt32LE(0, 18)
  localHeader.writeUInt32LE(0, 22)
  localHeader.writeUInt16LE(fileNameBuffer.length, 26)
  localHeader.writeUInt16LE(0, 28)

  const dataDescriptor = Buffer.alloc(16)
  dataDescriptor.writeUInt32LE(0x08074b50, 0)
  dataDescriptor.writeUInt32LE(0, 4)
  dataDescriptor.writeUInt32LE(compressedData.length, 8)
  dataDescriptor.writeUInt32LE(xmlBuffer.length, 12)

  const centralDirectoryOffset = localHeader.length + fileNameBuffer.length + compressedData.length + dataDescriptor.length
  const centralHeader = Buffer.alloc(46)
  centralHeader.writeUInt32LE(0x02014b50, 0)
  centralHeader.writeUInt16LE(20, 4)
  centralHeader.writeUInt16LE(20, 6)
  centralHeader.writeUInt16LE(0x08, 8)
  centralHeader.writeUInt16LE(8, 10)
  centralHeader.writeUInt16LE(0, 12)
  centralHeader.writeUInt16LE(0, 14)
  centralHeader.writeUInt32LE(0, 16)
  centralHeader.writeUInt32LE(compressedData.length, 20)
  centralHeader.writeUInt32LE(xmlBuffer.length, 24)
  centralHeader.writeUInt16LE(fileNameBuffer.length, 28)
  centralHeader.writeUInt16LE(0, 30)
  centralHeader.writeUInt16LE(0, 32)
  centralHeader.writeUInt16LE(0, 34)
  centralHeader.writeUInt16LE(0, 36)
  centralHeader.writeUInt32LE(0, 38)
  centralHeader.writeUInt32LE(0, 42)
  const centralDirectory = Buffer.concat([centralHeader, fileNameBuffer])

  const endOfCentralDirectory = Buffer.alloc(22)
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0)
  endOfCentralDirectory.writeUInt16LE(0, 4)
  endOfCentralDirectory.writeUInt16LE(0, 6)
  endOfCentralDirectory.writeUInt16LE(1, 8)
  endOfCentralDirectory.writeUInt16LE(1, 10)
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12)
  endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16)
  endOfCentralDirectory.writeUInt16LE(0, 20)

  return Buffer.concat([
    localHeader,
    fileNameBuffer,
    compressedData,
    dataDescriptor,
    centralDirectory,
    endOfCentralDirectory,
  ])
}

const ENHANCED_WEBSITE_HTML = `
  <html>
    <head>
      <title>Acme AI proposal platform</title>
      <meta name="description" content="Acme helps enterprise sales teams automate proposal workflows and improve revenue productivity.">
    </head>
    <body>
      <h1>AI proposal automation platform</h1>
      <h2>Services for enterprise sales teams</h2>
      <p>Our governed AI workflow platform helps sales teams reduce cost and improve productivity.</p>
      <p>Acme solutions support enterprise value management, content governance, and reusable commercial narratives.</p>
      <p>Trusted by enterprise customers to create more consistent sales outputs and faster executive-ready proposals.</p>
      <p>Industry teams in technology and business services use Acme to improve decision context.</p>
    </body>
  </html>
`

const LATE_METADATA_STYLE_PAYLOAD = '.QrIus{height:auto!important}.bsFmQ{overflow:hidden!important}'.repeat(3200)

const STYLE_ARTIFACT_WEBSITE_HTML = `
  <html>
    <head>
      <style>${LATE_METADATA_STYLE_PAYLOAD}</style>
      <title>Acme AI proposal platform</title>
      <meta name="description" content="Acme helps enterprise sales teams automate proposal workflows and improve revenue productivity.">
    </head>
    <body>
      <div>StylableButton2545352419__root{-archetype:box;cursor:pointer;box-sizing:border-box;touch-action:manipulation;border:0;width:100%;min-width:10px;height:100%;min-height:10px;padding:0;display:block}</div>
      <div>StylableButton2545352419__root[disabled]{pointer-events:none}</div>
      <div>PnnIOa:hover{transition:all 80ms cubic-bezier(0,0,1,1)}</div>
      <div>spC4EKo:focus:not(:hover){box-shadow:0 0 0 1px #fff,0 0 0 3px #116dff</div>
      <h1>AI proposal automation platform</h1>
      <p>Acme helps enterprise teams create governed value narratives and reusable commercial content.</p>
      <p>The platform supports repeatable executive-ready proposal workflows for customer-facing teams.</p>
    </body>
  </html>
`

const mockEnhancedWebsiteFetch = ({
  html = ENHANCED_WEBSITE_HTML,
  ok = true,
  status = 200,
  url = 'https://acme.example/',
  contentType = 'text/html; charset=utf-8',
} = {}) => {
  globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = jest.fn(async () => [
    { address: '93.184.216.34', family: 4 },
  ])
  globalThis.fetch = jest.fn(async () => ({
    ok,
    status,
    url,
    headers: {
      get: jest.fn((key) => {
        const normalizedKey = String(key).toLowerCase()
        if (normalizedKey === 'content-type') return contentType
        if (normalizedKey === 'content-length') return String(Buffer.byteLength(html, 'utf8'))
        return ''
      }),
    },
    text: jest.fn(async () => html),
  }))
}

const makeCustomerAdmin = (overrides = {}) => ({
  _id: CUSTOMER_ADMIN_ID,
  id: CUSTOMER_ADMIN_ID,
  email: 'custadmin@acme.com',
  name: 'Customer Admin',
  isActive: true,
  identityPlus: { trustStatus: 'TRUSTED' },
  memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
  tenantMemberships: [],
  vmfGrants: [],
  save: jest.fn(async function save() { return this }),
  toJSON: function toJSON() {
    return {
      id: this._id,
      email: this.email,
      name: this.name,
      memberships: this.memberships,
      tenantMemberships: this.tenantMemberships,
    }
  },
  ...overrides,
})

const makeRegularUser = (overrides = {}) => ({
  _id: REGULAR_USER_ID,
  id: REGULAR_USER_ID,
  email: 'user@acme.com',
  name: 'Regular User',
  isActive: true,
  identityPlus: { trustStatus: 'TRUSTED' },
  memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
  tenantMemberships: [
    { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] },
  ],
  vmfGrants: [],
  save: jest.fn(async function save() { return this }),
  toJSON: function toJSON() {
    return {
      id: this._id,
      email: this.email,
      name: this.name,
      memberships: this.memberships,
      tenantMemberships: this.tenantMemberships,
    }
  },
  ...overrides,
})

const makeSuperAdmin = (overrides = {}) => ({
  _id: SUPER_ADMIN_ID,
  id: SUPER_ADMIN_ID,
  email: 'superadmin@storylineos.test',
  name: 'Super Admin',
  isActive: true,
  identityPlus: { trustStatus: 'TRUSTED' },
  memberships: [{ customerId: null, roles: ['SUPER_ADMIN'] }],
  tenantMemberships: [],
  vmfGrants: [],
  save: jest.fn(async function save() { return this }),
  toJSON: function toJSON() {
    return {
      id: this._id,
      email: this.email,
      name: this.name,
      memberships: this.memberships,
      tenantMemberships: this.tenantMemberships,
    }
  },
  ...overrides,
})

const makeCustomerScopedTenantAdmin = (overrides = {}) => makeRegularUser({
  name: 'Customer Scoped Tenant Admin',
  memberships: [{ customerId: CUSTOMER_ID, roles: ['TENANT_ADMIN', 'USER'] }],
  tenantMemberships: [
    { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] },
  ],
  ...overrides,
})

const makeCustomer = (overrides = {}) => ({
  _id: CUSTOMER_ID,
  id: CUSTOMER_ID,
  name: 'Acme Corp',
  topology: 'MULTI_TENANT',
  vmfPolicy: 'PER_TENANT_MULTI',
  defaultTenantId: null,
  status: 'ACTIVE',
  entitlements: ['VMF'],
  licenseLevelId: null,
  governance: {
    maxTenants: 10,
    maxVmfsPerTenant: 10,
  },
  ...overrides,
})

const makeTenant = (overrides = {}) => ({
  _id: TENANT_ID,
  id: TENANT_ID,
  customerId: CUSTOMER_ID,
  name: 'Tenant One',
  status: 'ENABLED',
  isDefault: false,
  ...overrides,
})

const makeFrameworkPackage = (overrides = {}) => ({
  _id: FRAMEWORK_PACKAGE_ID,
  id: FRAMEWORK_PACKAGE_ID,
  frameworkKey: 'VMF',
  frameworkName: 'Value Messaging Framework',
  packageName: 'VMF Standard',
  packageKey: 'vmf-standard-2-3-1',
  version: '2.3.1',
  status: 'ACTIVE',
  isDefault: true,
  visibility: 'INTERNAL_ONLY',
  customerAccessMode: 'ALL_CUSTOMERS',
  assignedCustomerIds: [],
  dependencyLock: {
    status: 'PASS',
    snapshotId: 'dep-lock-vmf-standard-2-3-1',
    snapshotHash: 'hash-vmf-standard-2-3-1',
    references: [
      {
        componentType: 'UI_CONTRACT',
        stableId: 'vmf-cli-ui-contract',
        componentVersion: '2.3.1',
      },
    ],
  },
  runtimeVerdict: {
    result: 'ALLOW',
    auditPersisted: true,
    dependencyLockState: 'LOCKED',
    lastValidatedAt: '2026-05-18T10:00:00.000Z',
  },
  ...overrides,
})

const makeRuntimeDeployment = (overrides = {}) => ({
  _id: 'b27f1f77bcf86cd799439111',
  deploymentId: 'deployment-vmf-global-production-001',
  activationId: 'activation-vmf-2-3-1-001',
  packageId: FRAMEWORK_PACKAGE_ID,
  packageKey: 'vmf-standard-2-3-1',
  frameworkKey: 'VMF',
  frameworkVersion: '2.3.1',
  status: 'ACTIVE',
  registeredAt: '2026-05-18T10:05:00.000Z',
  ...overrides,
})

const makeRuntimeActivationSnapshot = (overrides = {}) => ({
  _id: 'c27f1f77bcf86cd799439111',
  activationId: 'activation-vmf-2-3-1-001',
  deploymentId: 'deployment-vmf-global-production-001',
  packageId: FRAMEWORK_PACKAGE_ID,
  packageKey: 'vmf-standard-2-3-1',
  frameworkKey: 'VMF',
  frameworkVersion: '2.3.1',
  activationStatus: 'ACTIVE',
  dependencySnapshotId: 'dep-lock-vmf-standard-2-3-1',
  dependencySnapshotHash: 'hash-vmf-standard-2-3-1',
  activatedAt: '2026-05-18T10:00:00.000Z',
  ...overrides,
})

const makeRuntimeInstance = (overrides = {}) => ({
  _id: RUNTIME_INSTANCE_ID,
  id: RUNTIME_INSTANCE_ID,
  runtimeInstanceKey: 'value-narrative-439111',
  customerId: CUSTOMER_ID,
  tenantId: TENANT_ID,
  workspaceId: '',
  runtimeType: 'VALUE_NARRATIVE',
  frameworkKey: 'VMF',
  packageId: FRAMEWORK_PACKAGE_ID,
  packageKey: 'vmf-standard-2-3-1',
  packageVersion: '2.3.1',
  dependencyLockId: 'dep-lock-vmf-standard-2-3-1',
  activationId: 'activation-vmf-2-3-1-001',
  deploymentId: 'deployment-vmf-global-production-001',
  evidence: {
    activationId: 'activation-vmf-2-3-1-001',
    deploymentId: 'deployment-vmf-global-production-001',
    dependencySnapshotId: 'dep-lock-vmf-standard-2-3-1',
    dependencySnapshotHash: 'hash-vmf-standard-2-3-1',
  },
  status: 'ACTIVE',
  executionStatus: 'IDLE',
  runtimeMode: 'INTERACTIVE',
  name: 'Acme Value Narrative',
  description: '',
  lockedAt: null,
  lockedBy: null,
  lockedReason: '',
  framework_state: {
    lifecycle: { stage: 'DRAFT' },
    sections: {},
    validation: {},
    readiness: {},
    publish: {},
    lock: {},
    policy: {},
    attachments: {},
    artifacts: {},
  },
  assignedTo: [],
  anchors: [],
  createdBy: CUSTOMER_ADMIN_ID,
  updatedBy: CUSTOMER_ADMIN_ID,
  createdAt: '2026-05-19T08:00:00.000Z',
  updatedAt: '2026-05-19T08:00:00.000Z',
  toJSON: function toJSON() {
    return { ...this, id: this._id }
  },
  ...overrides,
})

const makeRuntimeInstanceDocument = (overrides = {}) => {
  const document = {
    ...makeRuntimeInstance(overrides),
    save: jest.fn(async function save() { return this }),
    markModified: jest.fn(),
    toJSON: function toJSON() {
      return { ...this, id: this._id }
    },
  }

  return document
}

const makeRendererFrameworkPackage = (overrides = {}) => makeFrameworkPackage({
  uiContractKey: UI_CONTRACT_KEY,
  uiContractBinding: {
    key: UI_CONTRACT_KEY,
    version: '2.3.1',
    status: 'ACTIVE',
    compatibilityMode: 'INHERITED_MINOR',
    resolvedAt: '2026-05-18T10:00:00.000Z',
  },
  sections: [
    {
      sectionKey: 'customer_problem',
      runtimePath: 'framework_state.sections.customer_problem',
      required: true,
      validationKeys: ['required-sections-check'],
    },
  ],
  workflowBindings: [
    {
      policyKey: 'submit-for-review-policy',
      executionContext: 'ON_SUBMIT',
      priority: 10,
      enabled: true,
    },
  ],
  ...overrides,
})

const makeRuntimePathRecord = (overrides = {}) => ({
  stableId: 'path-framework-state-sections-customer-problem',
  pathKey: 'framework_state.sections.customer_problem',
  label: 'Customer Problem',
  status: 'ACTIVE',
  frameworkKeys: ['VMF'],
  scope: 'FRAMEWORK_STATE',
  allowedOperations: ['READ', 'WRITE', 'BIND'],
  dataType: 'STRING',
  category: 'SECTION',
  sourceType: 'RUNTIME_STATE',
  uiControl: 'TEXTAREA',
  helpText: 'Describe the core problem.',
  placeholderText: 'Example: Proposal creation is slow.',
  displayOrder: 10,
  ...overrides,
})

const makeEvidencePackRuntimePathRecord = (overrides = {}) => makeRuntimePathRecord({
  stableId: 'path-framework-state-evidence-pack',
  pathKey: 'framework_state.evidence_pack',
  label: 'Intelligence Hub Evidence Pack',
  allowedOperations: ['READ', 'WRITE'],
  dataType: 'OBJECT',
  category: 'STATE',
  uiControl: 'JSON',
  displayOrder: 1,
  ...overrides,
})

const buildRuntimePathFindOneMock = (records = []) => jest.fn((query = {}) => {
  const runtimePath = query.pathKey
  const record = records.find((candidate) => candidate.pathKey === runtimePath) || null
  return buildLeanQuery(record)
})

const makeReadyDiscoveryEvidencePack = (overrides = {}) => ({
  inputComplete: true,
  evidenceReady: true,
  accepted: false,
  needsRefresh: false,
  refreshedAt: '2026-05-19T08:00:30.000Z',
  inputs: {
    companyWebsite: 'https://acme.example',
    companyName: 'Acme',
    marketRegion: 'UK enterprise',
    targetOffer: 'Managed proposal platform',
  },
  evidence: {
    source: 'DISCOVERY_INPUTS',
    inputKeys: ['companyWebsite', 'companyName', 'marketRegion', 'targetOffer'],
    requiredInputKeys: ['companyWebsite', 'companyName', 'marketRegion', 'targetOffer'],
    missingInputKeys: [],
    builtAt: '2026-05-19T08:00:30.000Z',
    inputHash: 'sha256:ready-input-hash',
    sourceRefs: ['input_companyWebsite', 'input_companyName', 'input_marketRegion', 'input_targetOffer'],
  },
  summaries: {
    compact: {
      summary: 'Customer-provided discovery inputs captured for Acme.',
      confidence: 'USER_PROVIDED',
      sourceRefs: ['input_companyWebsite', 'input_companyName', 'input_marketRegion', 'input_targetOffer'],
    },
  },
  scoped_views: {
    customer_problem: {
      source: 'DISCOVERY_EVIDENCE_PACK',
      inputKeys: ['companyWebsite', 'companyName', 'marketRegion', 'targetOffer'],
      sourceRefs: ['input_companyWebsite', 'input_companyName', 'input_marketRegion', 'input_targetOffer'],
    },
  },
  lineage: {
    sources: [
      {
        sourceId: 'input_companyWebsite',
        type: 'USER_PROVIDED_WEBSITE',
        fieldKey: 'companyWebsite',
        url: 'https://acme.example',
        valueHash: 'sha256:company-website-hash',
        status: 'USER_PROVIDED',
        capturedAt: '2026-05-19T08:00:30.000Z',
      },
    ],
    builder: {
      mode: 'DETERMINISTIC',
      version: 'discovery-evidence-pack-v1',
      adapter: 'customer-input',
    },
  },
  state: {
    status: 'EVIDENCE_READY',
    inputComplete: true,
    evidenceReady: true,
    accepted: false,
    needsRefresh: false,
  },
  ...overrides,
})

const makeDiscoveryEvidenceObject = (overrides = {}) => ({
  evidenceObjectId: 'evidence_companyWebsite_fixture',
  sourceId: 'input_companyWebsite',
  category: 'Company',
  coverageArea: 'Company',
  extractedFact: 'Company website: https://acme.example',
  confidence: {
    level: 'USER_PROVIDED',
    score: 65,
    basis: ['DETERMINISTIC_DISCOVERY_INPUT'],
  },
  createdAt: '2026-05-19T08:00:30.000Z',
  reviewStatus: 'PENDING',
  acquisitionMethod: 'CUSTOMER_PROVIDED_INPUT',
  extractionTimestamp: '2026-05-19T08:00:30.000Z',
  acceptedBy: '',
  acceptanceTimestamp: '',
  rejectedBy: '',
  rejectionTimestamp: '',
  auditRef: '',
  lineageRef: 'lineage:input_companyWebsite:fixture',
  acquisitionProfile: 'STANDARD',
  ...overrides,
})

const makeDiscoverySourceRegistryEntry = (overrides = {}) => {
  const entry = {
    sourceId: 'input_companyWebsite',
    sourceType: 'WEBSITE',
    label: 'Company Website',
    status: 'AVAILABLE',
    dateAdded: '2026-05-19T08:00:30.000Z',
    acquisitionStatus: 'CAPTURED',
    evidenceProduced: 1,
    lastAcquisitionAt: '2026-05-19T08:00:30.000Z',
    lineageRef: 'lineage:input_companyWebsite:fixture',
    acquisitionProfile: 'STANDARD',
    fieldKey: 'companyWebsite',
    url: 'https://acme.example',
    ...overrides,
  }

  if (entry.url === undefined) delete entry.url
  return entry
}

const makeReviewableDiscoveryEvidencePack = (overrides = {}) => {
  const evidenceObjects = overrides.evidenceObjects || [
    makeDiscoveryEvidenceObject(),
    makeDiscoveryEvidenceObject({
      evidenceObjectId: 'evidence_targetOffer_fixture',
      sourceId: 'input_targetOffer',
      category: 'Products',
      coverageArea: 'Products',
      extractedFact: 'Target offer: Managed proposal platform',
      lineageRef: 'lineage:input_targetOffer:fixture',
    }),
  ]
  const sourceRegistry = overrides.sourceRegistry || [
    makeDiscoverySourceRegistryEntry(),
    makeDiscoverySourceRegistryEntry({
      sourceId: 'input_targetOffer',
      sourceType: 'DISCOVERY_NOTES',
      label: 'Target Product or Offer',
      lineageRef: 'lineage:input_targetOffer:fixture',
      fieldKey: 'targetOffer',
      url: undefined,
    }),
  ]
  const reviewSummary = {
    evidenceObjectCount: evidenceObjects.length,
    acceptedEvidenceCount: evidenceObjects.filter((evidenceObject) => evidenceObject.reviewStatus === 'ACCEPTED').length,
    pendingReviewCount: evidenceObjects.filter((evidenceObject) => evidenceObject.reviewStatus === 'PENDING').length,
    rejectedEvidenceCount: evidenceObjects.filter((evidenceObject) => evidenceObject.reviewStatus === 'REJECTED').length,
  }
  const coverage = {
    status: 'SUFFICIENT_FOR_FRAMEWORK',
    requiredInputCount: 4,
    completedRequiredInputCount: 4,
    inputCount: 4,
    missingAreas: [],
    sourceCount: sourceRegistry.length,
    evidenceObjectCount: reviewSummary.evidenceObjectCount,
    acceptedEvidenceCount: reviewSummary.acceptedEvidenceCount,
    pendingReviewCount: reviewSummary.pendingReviewCount,
    rejectedEvidenceCount: reviewSummary.rejectedEvidenceCount,
    score: 100,
  }

  return {
    ...makeReadyDiscoveryEvidencePack(),
    acquisitionProfile: 'STANDARD',
    sourceRegistry,
    evidenceObjects,
    discoveryHealth: {
      coveragePercent: 20,
      confidence: 'STANDARD',
      evidenceObjectCount: reviewSummary.evidenceObjectCount,
      acceptedEvidenceCount: reviewSummary.acceptedEvidenceCount,
      pendingReviewCount: reviewSummary.pendingReviewCount,
      rejectedEvidenceCount: reviewSummary.rejectedEvidenceCount,
      sourceCount: sourceRegistry.length,
      missingAreas: ['Services', 'Markets', 'Industries', 'Proof', 'Economics', 'Differentiation', 'Decision Context', 'Constraints'],
      acquisitionProfile: 'STANDARD',
      lastAcquisitionDate: '2026-05-19T08:00:30.000Z',
      coverageAreas: [],
    },
    acquisition: {
      profile: 'STANDARD',
      status: 'EVIDENCE_READY',
      coverage,
      confidence: {
        level: 'STANDARD',
        score: 65,
        basis: ['USER_PROVIDED_INPUTS', 'DETERMINISTIC_EVIDENCE_PACK'],
      },
      sourceRegistry,
    },
    evidence: {
      ...makeReadyDiscoveryEvidencePack().evidence,
      coverage,
      reviewSummary,
    },
    ...overrides,
  }
}

const makeSectionEvidenceObject = (overrides = {}) => ({
  evidenceObjectId: 'section_evidence_value_fixture',
  sectionKey: 'value_drivers',
  runtimePath: 'framework_state.sections.value_drivers',
  sourceId: 'section_document_value_fixture',
  sourceType: 'SECTION_UPLOADED_DOCUMENT',
  category: 'Value Drivers',
  coverageArea: 'Decision Context',
  extractedFact: 'Document Section Supporting File: governed workflow automation reduces manual effort.',
  confidence: {
    level: 'SOURCE_BACKED',
    score: 74,
    basis: ['UPLOADED_DOCUMENT', 'DETERMINISTIC_TEXT_EXTRACTION'],
  },
  createdAt: '2026-05-19T08:02:00.000Z',
  reviewStatus: 'PENDING',
  acquisitionMethod: 'SECTION_DOCUMENT_INGESTION',
  extractionTimestamp: '2026-05-19T08:02:00.000Z',
  acceptedBy: '',
  acceptanceTimestamp: '',
  rejectedBy: '',
  rejectionTimestamp: '',
  auditRef: '',
  lineageRef: 'lineage:section_document_value_fixture:section_evidence_value_fixture',
  acquisitionProfile: '',
  sourceFileName: 'value-notes.md',
  documentAssetType: 'SECTION_SUPPORTING_FILE',
  ...overrides,
})

const makeSectionAdditionalEvidence = ({
  documents = [
    {
      sectionDocumentId: 'section_document_value_fixture',
      sourceId: 'section_document_value_fixture',
      fileName: 'value-notes.md',
      fileType: 'TXT',
      mimeType: 'text/markdown',
      sizeBytes: 92,
      uploadedAt: '2026-05-19T08:02:00.000Z',
      uploadedBy: CUSTOMER_ADMIN_ID,
      status: 'PROCESSED',
      ingestionMode: 'TEXT_NATIVE',
      evidenceObjectsGenerated: 1,
    },
  ],
  evidenceObjects = [makeSectionEvidenceObject()],
  status = 'PENDING_REVIEW',
} = {}) => {
  const acceptedEvidenceObjectCount = evidenceObjects.filter((evidenceObject) => evidenceObject.reviewStatus === 'ACCEPTED').length
  const pendingEvidenceObjectCount = evidenceObjects.filter((evidenceObject) => evidenceObject.reviewStatus === 'PENDING').length
  const rejectedEvidenceObjectCount = evidenceObjects.filter((evidenceObject) => evidenceObject.reviewStatus === 'REJECTED').length

  return {
    status,
    updatedAt: '2026-05-19T08:02:00.000Z',
    updatedBy: CUSTOMER_ADMIN_ID,
    documentCount: documents.length,
    evidenceObjectCount: evidenceObjects.length,
    acceptedEvidenceObjectCount,
    pendingEvidenceObjectCount,
    rejectedEvidenceObjectCount,
    documents,
  }
}

const makeSectionEvidencePackage = () => makeRendererFrameworkPackage({
  sections: [
    {
      sectionKey: 'customer_problem',
      runtimePath: 'framework_state.sections.customer_problem',
      required: true,
    },
    {
      sectionKey: 'value_drivers',
      runtimePath: 'framework_state.sections.value_drivers',
      required: true,
    },
  ],
})

const makeSectionEvidenceRuntimePathRecords = () => [
  makeRuntimePathRecord(),
  makeRuntimePathRecord({
    stableId: 'path-framework-state-sections-value-drivers',
    pathKey: 'framework_state.sections.value_drivers',
    label: 'Value Drivers',
    allowedOperations: ['READ', 'WRITE', 'BIND'],
    displayOrder: 20,
  }),
]

const makeSectionEvidenceUIContract = () => makeUIContract({
  sections: [
    makeUIContract().sections[0],
    {
      sectionKey: 'value_drivers',
      runtimePath: 'framework_state.sections.value_drivers',
      source: 'PACKAGE',
      isCustom: false,
      label: 'Value Drivers',
      displayOrder: 20,
      isVisible: true,
      isEditable: true,
      isRequiredDisplay: true,
      isReadOnlyDisplay: false,
    },
  ],
})

const actionLabels = {
  SAVE_DISCOVERY_INPUTS: 'Save Intelligence Hub Inputs',
  BUILD_EVIDENCE_PACK: 'Build Evidence Pack',
  REFRESH_EVIDENCE_PACK: 'Refresh Evidence Pack',
  ACCEPT_EVIDENCE: 'Accept Evidence',
  RUN_VALIDATION: 'Run Validation',
  MARK_READY: 'Mark Ready',
  SUBMIT_FOR_REVIEW: 'Submit for Review',
  RETURN_TO_DRAFT: 'Return to Draft',
  SAVE_DRAFT: 'Save Draft',
  GENERATE_SECTION: 'Generate Section',
  REGENERATE_SECTION: 'Regenerate Section',
  APPROVE: 'Approve',
  PUBLISH: 'Publish',
  LOCK_RECORD: 'Lock Record',
}

const makeActionPolicyKey = (actionKey) =>
  `${String(actionKey || '').trim().toLowerCase().replace(/_/g, '-')}-policy`

const makeWorkflowBinding = (actionKey, overrides = {}) => ({
  policyKey: makeActionPolicyKey(actionKey),
  executionContext: 'MANUAL_RUN',
  priority: 10,
  enabled: true,
  ...overrides,
})

const makeUIAction = (actionKey, overrides = {}) => ({
  actionKey,
  governedAction: actionKey,
  buttonLabel: actionLabels[actionKey] || actionKey,
  confirmationMessage: '',
  successMessage: `${actionLabels[actionKey] || actionKey} completed.`,
  displayOrder: 10,
  isVisible: true,
  requiresConfirmation: false,
  ...overrides,
})

const makeUIContract = (overrides = {}) => ({
  stableId: `ui-contract-${UI_CONTRACT_KEY}`,
  uiContractKey: UI_CONTRACT_KEY,
  name: 'VMF CLI UI Contract',
  status: 'ACTIVE',
  frameworkKeys: ['VMF'],
  sections: [
    {
      sectionKey: 'customer_problem',
      runtimePath: 'framework_state.sections.customer_problem',
      source: 'PACKAGE',
      isCustom: false,
      label: 'Customer Problem',
      shortLabel: 'Problem',
      helpText: 'Describe the core problem.',
      placeholder: 'Example: Proposal creation is slow.',
      displayOrder: 10,
      isVisible: true,
      isEditable: true,
      isRequiredDisplay: true,
      isReadOnlyDisplay: false,
    },
  ],
  actions: [
    makeUIAction('SUBMIT_FOR_REVIEW', {
      confirmationMessage: 'Submit this framework for review?',
      requiresConfirmation: true,
    }),
  ],
  ...overrides,
})

const makeWorkflowPolicy = (overrides = {}) => ({
  stableId: 'policy-submit-for-review-policy',
  key: 'submit-for-review-policy',
  name: 'Submit for Review',
  status: 'ACTIVE',
  frameworkKeys: ['VMF'],
  governedAction: 'SUBMIT_FOR_REVIEW',
  triggerEvent: 'ON_SUBMIT',
  decisionMode: 'ALLOW',
  priority: 10,
  conditions: [
    {
      path: 'framework_state.lifecycle.stage',
      operator: '=',
      value: 'DRAFT',
    },
  ],
  passMessage: 'Submit action is available.',
  failMessage: 'Submit action is not available.',
  ...overrides,
})

const makeActionWorkflowPolicy = (actionKey, overrides = {}) => makeWorkflowPolicy({
  stableId: `policy-${makeActionPolicyKey(actionKey)}`,
  key: makeActionPolicyKey(actionKey),
  name: actionLabels[actionKey] || actionKey,
  governedAction: actionKey,
  triggerEvent: 'MANUAL_RUN',
  conditions: [],
  passMessage: `${actionLabels[actionKey] || actionKey} is available.`,
  failMessage: `${actionLabels[actionKey] || actionKey} is not available.`,
  ...overrides,
})

const mockRuntimeInstanceForActionExecution = ({ document, rendererRuntimeInstance = document }) => {
  RuntimeInstance.findOne = jest.fn()
    .mockImplementationOnce(() => Promise.resolve(document))
    .mockImplementation(() => buildLeanQuery(rendererRuntimeInstance))
}

const buildRoleQueryChain = (rows) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

const buildUserQueryChain = (value) => {
  const promise = Promise.resolve(value)
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockImplementation(() => promise),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  }
}

const buildLeanQuery = (value) => ({
  lean: jest.fn().mockResolvedValue(value),
})

const buildSelectableLeanQuery = (value) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(value),
})

const buildRuntimeInstanceFindChain = (rows) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

const buildAuditLogFindChain = (rows) => ({
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

const buildDefaultRoleRows = () => ([
  {
    key: 'SUPER_ADMIN',
    scope: 'PLATFORM',
    permissions: ['CUSTOMER_VIEW', 'VMF_CREATE', 'VMF_UPDATE', 'VMF_VIEW'],
    isActive: true,
  },
  {
    key: 'CUSTOMER_ADMIN',
    scope: 'CUSTOMER',
    permissions: ['CUSTOMER_VIEW', 'VMF_CREATE', 'VMF_UPDATE', 'VMF_VIEW'],
    isActive: true,
  },
  {
    key: 'USER',
    scope: 'VMF',
    permissions: ['VMF_VIEW', 'DEAL_VIEW'],
    isActive: true,
  },
])

const buildTenantAdminRoleRows = () => ([
  ...buildDefaultRoleRows(),
  {
    key: 'TENANT_ADMIN',
    scope: 'TENANT',
    permissions: ['TENANT_VIEW', 'VMF_VIEW', 'VMF_CREATE'],
    isActive: true,
  },
])

let app
let request
let tokenService
let User
let Role
let Customer
let Tenant
let FrameworkPackage
let RuntimeDeployment
let RuntimeActivationSnapshot
let RuntimeInstance
let RuntimePathRegistry
let UIContract
let WorkflowPolicy
let AuditLog
let mockRedisClient
let hashSectionInput

const getAccessTokenForUser = async (user) => {
  const tokens = await tokenService.generateTokens(user)
  return tokens.accessToken
}

beforeAll(async () => {
  mockRedisClient = {
    set: jest.fn(),
    setex: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
  }

  await jest.unstable_mockModule('../config/redis.js', () => ({
    connectRedis: jest.fn(),
    getRedis: jest.fn(() => mockRedisClient),
    isRedisConnected: jest.fn(() => true),
    disconnectRedis: jest.fn(),
  }))

  const supertest = (await import('supertest')).default
  app = (await import('../app.js')).default
  tokenService = (await import('../services/tokenService.js')).default
  request = supertest(app)

  const models = await import('../models/index.js')
  User = models.User
  Role = models.Role
  Customer = models.Customer
  Tenant = models.Tenant
  FrameworkPackage = models.FrameworkPackage
  RuntimeDeployment = models.RuntimeDeployment
  RuntimeActivationSnapshot = models.RuntimeActivationSnapshot
  RuntimeInstance = models.RuntimeInstance
  RuntimePathRegistry = models.RuntimePathRegistry
  UIContract = models.UIContract
  WorkflowPolicy = models.WorkflowPolicy
  AuditLog = models.AuditLog
  hashSectionInput = (await import('../services/runtimeSectionModelService.js')).hashSectionInput
})

beforeEach(() => {
  globalThis.fetch = originalFetch
  globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = originalDiscoveryDnsLookup
  User.findById = jest.fn().mockImplementation((userId) => {
    if (userId === CUSTOMER_ADMIN_ID) {
      return buildUserQueryChain(makeCustomerAdmin())
    }

    if (userId === SUPER_ADMIN_ID) {
      return buildUserQueryChain(makeSuperAdmin())
    }

    if (userId === REGULAR_USER_ID) {
      return buildUserQueryChain(makeRegularUser())
    }

    return buildUserQueryChain(null)
  })

  Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildDefaultRoleRows()))
  Customer.findById = jest.fn().mockResolvedValue(makeCustomer())
  Tenant.findById = jest.fn().mockResolvedValue(makeTenant())
  FrameworkPackage.findById = jest.fn().mockResolvedValue(makeFrameworkPackage())
  FrameworkPackage.findOne = jest.fn()
  RuntimeDeployment.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeDeployment()))
  RuntimeActivationSnapshot.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeActivationSnapshot()))
  RuntimePathRegistry.find = jest.fn().mockReturnValue(buildLeanQuery([]))
  RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
  UIContract.findOne = jest.fn().mockReturnValue(buildLeanQuery(null))
  WorkflowPolicy.find = jest.fn().mockReturnValue(buildLeanQuery([]))
  RuntimeInstance.prototype.save = jest.fn(async function save() { return this })
  RuntimeInstance.find = jest.fn().mockReturnValue(buildRuntimeInstanceFindChain([makeRuntimeInstance()]))
  RuntimeInstance.findOne = jest.fn().mockImplementation((query) => {
    if (query?.runtimeInstanceKey) {
      return buildSelectableLeanQuery(null)
    }

    return buildLeanQuery(makeRuntimeInstance())
  })
  RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
    ...makeRuntimeInstance(),
    ...(update?.$set || {}),
    updatedAt: new Date('2026-05-19T08:01:00.000Z'),
  }))
  RuntimeInstance.countDocuments = jest.fn().mockResolvedValue(1)
  RuntimeInstance.distinct = jest.fn().mockResolvedValue([1])
  RuntimeInstance.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 })
  AuditLog.find = jest.fn().mockReturnValue(buildAuditLogFindChain([]))
  AuditLog.createLog = jest.fn(async () => ({}))
})

describe('Runtime Instance API', () => {
  test('POST /api/v1/runtime-instances returns 401 without auth token', async () => {
    const res = await request.post('/api/v1/runtime-instances').send({})
    expect(res.status).toBe(401)
  })

  test('creates a runtime instance from an ACTIVE package with certified activation evidence', async () => {
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        frameworkKey: 'VMF',
        runtimeType: 'VALUE_NARRATIVE',
        name: 'Acme Value Narrative',
        description: 'Draft narrative',
      })

    expect(res.status).toBe(201)
    expect(res.body.data).toEqual(expect.objectContaining({
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      runtimeType: 'VALUE_NARRATIVE',
      frameworkKey: 'VMF',
      packageId: FRAMEWORK_PACKAGE_ID,
      packageKey: 'vmf-standard-2-3-1',
      packageVersion: '2.3.1',
      dependencyLockId: 'dep-lock-vmf-standard-2-3-1',
      activationId: 'activation-vmf-2-3-1-001',
      deploymentId: 'deployment-vmf-global-production-001',
      status: 'ACTIVE',
      executionStatus: 'IDLE',
      runtimeMode: 'INTERACTIVE',
      name: 'Acme Value Narrative',
    }))
    expect(res.body.data.framework_state).toEqual({
      lifecycle: { stage: 'DRAFT' },
      sections: {},
      evidence_pack: {},
      validation: {},
      readiness: {},
      publish: {},
      lock: {},
      policy: {},
      attachments: {},
      artifacts: {},
    })
    expect(res.body.data.runtimeCapacitySlot).toBeUndefined()
    expect(FrameworkPackage.findById).toHaveBeenCalledWith(FRAMEWORK_PACKAGE_ID)
    expect(FrameworkPackage.findOne).not.toHaveBeenCalled()
    expect(RuntimeInstance.countDocuments).toHaveBeenCalledWith({
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      runtimeType: 'VALUE_NARRATIVE',
      status: 'ACTIVE',
    })
    expect(RuntimeInstance.distinct).toHaveBeenCalledWith('runtimeCapacitySlot', {
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      runtimeType: 'VALUE_NARRATIVE',
      status: 'ACTIVE',
      runtimeCapacitySlot: { $type: 'number' },
    })
    expect(RuntimeInstance.prototype.save.mock.contexts[0].runtimeCapacitySlot).toBe(2)
    expect(RuntimeDeployment.findOne).toHaveBeenCalledWith({
      packageId: expect.anything(),
      frameworkKey: 'VMF',
      status: 'ACTIVE',
    })
    expect(RuntimeActivationSnapshot.findOne).toHaveBeenCalledWith({
      activationId: 'activation-vmf-2-3-1-001',
      packageId: expect.anything(),
      activationStatus: 'ACTIVE',
    })
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_INSTANCE_CREATED',
      resourceType: 'RuntimeInstance',
      resourceId: expect.anything(),
    }))
  })

  test('allows the default active VMF package even when visibility is internal-only', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeFrameworkPackage({
      isDefault: true,
      visibility: 'INTERNAL_ONLY',
      customerAccessMode: 'ALL_CUSTOMERS',
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'Default Package Narrative',
      })

    expect(res.status).toBe(201)
    expect(res.body.data.packageKey).toBe('vmf-standard-2-3-1')
  })

  test('rejects Value Narrative runtime creation when tenant runtime capacity is exhausted', async () => {
    Customer.findById = jest.fn().mockResolvedValue(makeCustomer({
      governance: {
        maxTenants: 10,
        maxVmfsPerTenant: 1,
      },
    }))
    RuntimeInstance.countDocuments = jest.fn().mockResolvedValue(1)
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'Capacity Blocked Narrative',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.details).toEqual(expect.objectContaining({
      reason: 'VMF_LIMIT_REACHED',
      limitType: 'MAX_VMFS_PER_TENANT',
      limit: 1,
      currentCount: 1,
      tenantId: TENANT_ID,
    }))
    expect(FrameworkPackage.findById).not.toHaveBeenCalled()
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects concurrent Value Narrative runtime creation when the capacity slot is already taken', async () => {
    RuntimeInstance.countDocuments = jest.fn().mockResolvedValue(0)
    RuntimeInstance.distinct = jest.fn().mockResolvedValue([])
    RuntimeInstance.prototype.save = jest.fn(async () => {
      const err = new Error('E11000 duplicate key error runtimeCapacitySlot')
      err.code = 11000
      err.keyPattern = {
        customerId: 1,
        tenantId: 1,
        runtimeType: 1,
        status: 1,
        runtimeCapacitySlot: 1,
      }
      err.keyValue = {
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        runtimeType: 'VALUE_NARRATIVE',
        status: 'ACTIVE',
        runtimeCapacitySlot: 1,
      }
      throw err
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'Concurrent Narrative',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.details).toEqual(expect.objectContaining({
      reason: 'VMF_LIMIT_REACHED',
      limitType: 'MAX_VMFS_PER_TENANT',
      limit: 10,
      currentCount: 10,
      tenantId: TENANT_ID,
    }))
    expect(RuntimeInstance.prototype.save.mock.contexts[0].runtimeCapacitySlot).toBe(1)
    expect(AuditLog.createLog).not.toHaveBeenCalled()
    expect(RuntimeInstance.deleteOne).not.toHaveBeenCalled()
  })

  test('allows a customer-scoped tenant admin assigned to the tenant to create a Value Narrative runtime', async () => {
    const tenantAdmin = makeCustomerScopedTenantAdmin()
    User.findById = jest.fn().mockImplementation((userId) => {
      if (userId === REGULAR_USER_ID) return buildUserQueryChain(tenantAdmin)
      return buildUserQueryChain(null)
    })
    Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildTenantAdminRoleRows()))
    Tenant.findById = jest.fn().mockResolvedValue(makeTenant({
      tenantAdminUserIds: [REGULAR_USER_ID],
    }))
    const token = await getAccessTokenForUser(tenantAdmin)

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        frameworkKey: 'VMF',
        runtimeType: 'VALUE_NARRATIVE',
        name: 'Assigned Tenant Admin Narrative',
      })

    expect(res.status).toBe(201)
    expect(res.body.data).toEqual(expect.objectContaining({
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      runtimeType: 'VALUE_NARRATIVE',
      name: 'Assigned Tenant Admin Narrative',
    }))
    expect(RuntimeInstance.prototype.save).toHaveBeenCalledTimes(1)
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_INSTANCE_CREATED',
      resourceType: 'RuntimeInstance',
    }))
  })

  test('rejects customer-scoped tenant admin runtime creation for an unassigned tenant', async () => {
    const tenantAdmin = makeCustomerScopedTenantAdmin()
    User.findById = jest.fn().mockImplementation((userId) => {
      if (userId === REGULAR_USER_ID) return buildUserQueryChain(tenantAdmin)
      return buildUserQueryChain(null)
    })
    Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildTenantAdminRoleRows()))
    Tenant.findById = jest.fn().mockResolvedValue(makeTenant({
      tenantAdminUserIds: [],
    }))
    const token = await getAccessTokenForUser(tenantAdmin)

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        frameworkKey: 'VMF',
        runtimeType: 'VALUE_NARRATIVE',
        name: 'Unassigned Tenant Admin Narrative',
      })

    expect(res.status).toBe(403)
    expect(res.body.error.details.reason).toBe('FORBIDDEN')
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects Deal Analysis runtime creation until a locked VMF anchor is supplied', async () => {
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        frameworkKey: 'VMF',
        runtimeType: 'DEAL_ANALYSIS',
        name: 'Acme Deal Analysis',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('DEAL_ANALYSIS_ANCHOR_REQUIRED')
    expect(FrameworkPackage.findById).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
  })

  test('rejects runtime creation for a non-active framework package', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeFrameworkPackage({ status: 'VALIDATED' }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'Inactive Package Narrative',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('PACKAGE_NOT_ACTIVE')
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
  })

  test('rejects runtime creation when dependency-lock evidence is missing', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeFrameworkPackage({
      dependencyLock: {
        status: 'PASS',
        snapshotId: '',
        references: [],
      },
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'Missing Evidence Narrative',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('DEPENDENCY_LOCK_REQUIRED')
    expect(RuntimeDeployment.findOne).not.toHaveBeenCalled()
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
  })

  test('rejects runtime creation when active deployment evidence is missing', async () => {
    RuntimeDeployment.findOne.mockReturnValue(buildLeanQuery(null))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'Missing Deployment Narrative',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('DEPLOYMENT_EVIDENCE_REQUIRED')
    expect(RuntimeActivationSnapshot.findOne).not.toHaveBeenCalled()
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
  })

  test('rejects runtime creation when activation snapshot evidence is missing', async () => {
    RuntimeActivationSnapshot.findOne.mockReturnValue(buildLeanQuery(null))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'Missing Activation Snapshot Narrative',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('ACTIVATION_EVIDENCE_REQUIRED')
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
  })

  test('rejects runtime creation when activation snapshot dependency evidence differs from package lock', async () => {
    RuntimeActivationSnapshot.findOne.mockReturnValue(buildLeanQuery(makeRuntimeActivationSnapshot({
      dependencySnapshotId: 'dep-lock-previous-certified-snapshot',
      dependencySnapshotHash: 'hash-previous-certified-snapshot',
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'Mismatched Evidence Narrative',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('DEPENDENCY_LOCK_EVIDENCE_MISMATCH')
    expect(res.body.error.details.packageDependencySnapshotId).toBe('dep-lock-vmf-standard-2-3-1')
    expect(res.body.error.details.activationDependencySnapshotId).toBe('dep-lock-previous-certified-snapshot')
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
  })

  test('rejects runtime creation when package is not available to the customer', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeFrameworkPackage({
      isDefault: false,
      visibility: 'CUSTOMER_VISIBLE',
      customerAccessMode: 'SELECTED_CUSTOMERS',
      assignedCustomerIds: [OTHER_CUSTOMER_ID],
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'Unavailable Package Narrative',
      })

    expect(res.status).toBe(403)
    expect(res.body.error.details.reason).toBe('PACKAGE_NOT_AVAILABLE_TO_CUSTOMER')
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
  })

  test('rejects runtime creation when the customer lacks the VMF entitlement', async () => {
    Customer.findById = jest.fn().mockResolvedValue(makeCustomer({ entitlements: ['DEALS'] }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'Unentitled Narrative',
      })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('LICENSE_FEATURE_NOT_ENABLED')
    expect(res.body.error.details.reason).toBe('FEATURE_NOT_ENABLED')
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
  })

  test('rejects runtime creation for a user without create permission', async () => {
    const token = await getAccessTokenForUser(makeRegularUser())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'User Created Narrative',
      })

    expect(res.status).toBe(403)
    expect(res.body.error.details.reason).toBe('FORBIDDEN')
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
  })

  test('rejects runtime creation when runtimeInstanceKey already exists before save', async () => {
    RuntimeInstance.findOne = jest.fn().mockImplementation((query) => {
      if (query?.runtimeInstanceKey === 'value-narrative-existing') {
        return buildSelectableLeanQuery({ _id: RUNTIME_INSTANCE_ID })
      }

      return buildLeanQuery(makeRuntimeInstance())
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        runtimeInstanceKey: 'value-narrative-existing',
        name: 'Duplicate Key Narrative',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_INSTANCE_KEY_CONFLICT')
    expect(AuditLog.createLog).not.toHaveBeenCalled()
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
  })

  test('translates runtimeInstanceKey unique-index races to a stable conflict response', async () => {
    RuntimeInstance.prototype.save = jest.fn(async () => {
      const err = new Error('E11000 duplicate key error collection: runtime_instances index: runtimeInstanceKey_1 dup key')
      err.code = 11000
      err.keyPattern = { runtimeInstanceKey: 1 }
      err.keyValue = { runtimeInstanceKey: 'value-narrative-race' }
      throw err
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        runtimeInstanceKey: 'value-narrative-race',
        name: 'Duplicate Race Narrative',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_INSTANCE_KEY_CONFLICT')
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('fails closed and does not persist runtime creation when audit write fails', async () => {
    AuditLog.createLog = jest.fn(async () => {
      throw new Error('audit store unavailable')
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'Audit Required Narrative',
      })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('RUNTIME_INSTANCE_AUDIT_FAILED')
    expect(res.body.error.details.reason).toBe('AUDIT_PERSISTENCE_FAILED')
    expect(RuntimeInstance.prototype.save).toHaveBeenCalledTimes(1)
    expect(RuntimeInstance.deleteOne).toHaveBeenCalledWith({ _id: expect.anything() })
  })

  test('lists runtime instances inside the requested customer and tenant scope', async () => {
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get('/api/v1/runtime-instances')
      .query({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        runtimeType: 'VALUE_NARRATIVE',
        page: 1,
        pageSize: 5,
      })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(RuntimeInstance.find).toHaveBeenCalledWith({
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      runtimeType: 'VALUE_NARRATIVE',
    })
    expect(RuntimeInstance.countDocuments).toHaveBeenCalledWith({
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      runtimeType: 'VALUE_NARRATIVE',
    })
    expect(RuntimeInstance.countDocuments).toHaveBeenCalledWith({
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      runtimeType: 'VALUE_NARRATIVE',
      status: 'ACTIVE',
    })
    expect(res.body.data[0]).toEqual(expect.objectContaining({
      id: RUNTIME_INSTANCE_ID,
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      runtimeType: 'VALUE_NARRATIVE',
    }))
    expect(res.body.meta).toEqual(expect.objectContaining({
      page: 1,
      pageSize: 5,
      total: 1,
      totalPages: 1,
      version: 'v1',
      runtimeCapacity: {
        runtimeType: 'VALUE_NARRATIVE',
        maxRuntimeInstances: 10,
        currentCount: 1,
        remainingCount: 9,
        isAtCapacity: false,
        countMode: 'ACTIVE_RUNTIME_INSTANCES',
        tenantId: TENANT_ID,
      },
    }))
  })

  test('searches runtime instances by customer-visible identity and package fields', async () => {
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get('/api/v1/runtime-instances')
      .query({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        runtimeType: 'VALUE_NARRATIVE',
        q: 'Northwind',
      })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(RuntimeInstance.find).toHaveBeenCalledWith(expect.objectContaining({
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      runtimeType: 'VALUE_NARRATIVE',
      $or: expect.arrayContaining([
        { name: expect.any(RegExp) },
        { description: expect.any(RegExp) },
        { runtimeInstanceKey: expect.any(RegExp) },
        { packageKey: expect.any(RegExp) },
        { packageVersion: expect.any(RegExp) },
      ]),
    }))
    expect(RuntimeInstance.countDocuments).toHaveBeenCalledWith(expect.objectContaining({
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      runtimeType: 'VALUE_NARRATIVE',
      $or: expect.any(Array),
    }))
  })

  test('requires runtimeType when listing runtime instances instead of falling back to VMF entitlement', async () => {
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get('/api/v1/runtime-instances')
      .query({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
      })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.details.runtimeType).toBe('runtimeType is required')
    expect(RuntimeInstance.find).not.toHaveBeenCalled()
  })

  test('returns 403 when listing another tenant without matching access', async () => {
    const token = await getAccessTokenForUser(makeRegularUser())

    const res = await request
      .get('/api/v1/runtime-instances')
      .query({
        customerId: CUSTOMER_ID,
        tenantId: OTHER_TENANT_ID,
        runtimeType: 'VALUE_NARRATIVE',
      })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.details.reason).toBe('FORBIDDEN')
    expect(RuntimeInstance.find).not.toHaveBeenCalled()
  })

  test('allows assigned customer-scoped tenant admins to list, open, and render runtime instances', async () => {
    const tenantAdmin = makeCustomerScopedTenantAdmin({
      tenantMemberships: [],
    })
    User.findById = jest.fn().mockImplementation((userId) => {
      if (userId === REGULAR_USER_ID) return buildUserQueryChain(tenantAdmin)
      return buildUserQueryChain(null)
    })
    Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildTenantAdminRoleRows()))
    Tenant.findById = jest.fn().mockResolvedValue(makeTenant({
      tenantAdminUserIds: [REGULAR_USER_ID],
    }))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [
        makeUIAction('SUBMIT_FOR_REVIEW'),
        makeUIAction('GENERATE_SECTION'),
        makeUIAction('REGENERATE_SECTION'),
      ],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([
      makeWorkflowPolicy(),
      makeActionWorkflowPolicy('GENERATE_SECTION'),
      makeActionWorkflowPolicy('REGENERATE_SECTION'),
    ]))
    const token = await getAccessTokenForUser(tenantAdmin)

    const listRes = await request
      .get('/api/v1/runtime-instances')
      .query({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        runtimeType: 'VALUE_NARRATIVE',
      })
      .set('Authorization', `Bearer ${token}`)
    const detailRes = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}`)
      .set('Authorization', `Bearer ${token}`)
    const rendererRes = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(listRes.status).toBe(200)
    expect(detailRes.status).toBe(200)
    expect(rendererRes.status).toBe(200)
    expect(rendererRes.body.data.runtimeInstance.runtimeInstanceKey).toBe('value-narrative-439111')
  })

  test('rejects unassigned customer-scoped tenant admins on list, detail, and renderer access', async () => {
    const tenantAdmin = makeCustomerScopedTenantAdmin({
      tenantMemberships: [],
    })
    User.findById = jest.fn().mockImplementation((userId) => {
      if (userId === REGULAR_USER_ID) return buildUserQueryChain(tenantAdmin)
      return buildUserQueryChain(null)
    })
    Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildTenantAdminRoleRows()))
    Tenant.findById = jest.fn().mockResolvedValue(makeTenant({
      tenantAdminUserIds: [],
    }))
    const token = await getAccessTokenForUser(tenantAdmin)

    const listRes = await request
      .get('/api/v1/runtime-instances')
      .query({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        runtimeType: 'VALUE_NARRATIVE',
      })
      .set('Authorization', `Bearer ${token}`)
    const detailRes = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}`)
      .set('Authorization', `Bearer ${token}`)
    const rendererRes = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(listRes.status).toBe(403)
    expect(detailRes.status).toBe(403)
    expect(rendererRes.status).toBe(403)
    expect(listRes.body.error.details.reason).toBe('FORBIDDEN')
    expect(detailRes.body.error.details.reason).toBe('FORBIDDEN')
    expect(rendererRes.body.error.details.reason).toBe('FORBIDDEN')
  })

  test('returns a runtime instance only after scope permission passes', async () => {
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOne).toHaveBeenCalledWith({
      $or: [
        { _id: RUNTIME_INSTANCE_ID },
        { runtimeInstanceKey: RUNTIME_INSTANCE_ID },
      ],
    })
    expect(res.body.data).toEqual(expect.objectContaining({
      id: RUNTIME_INSTANCE_ID,
      runtimeInstanceKey: 'value-narrative-439111',
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
    }))
  })

  test('PATCH /api/v1/runtime-instances/:id/data writes a section value through runtime state mutation audit', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'IN_REVIEW' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
        }),
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Proposal teams lack a shared story.',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: RUNTIME_INSTANCE_ID,
        updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      },
      {
        $set: expect.objectContaining({
          framework_state: expect.objectContaining({
            sections: expect.objectContaining({
              customer_problem: expect.objectContaining({
                input: 'Proposal teams lack a shared story.',
                generated: null,
                review: {},
                state: expect.objectContaining({
                  status: 'DRAFT',
                }),
                lineage: expect.objectContaining({
                  sectionKey: 'customer_problem',
                  runtimePath: 'framework_state.sections.customer_problem',
                }),
                revisions: [],
              }),
            }),
          }),
          updatedBy: CUSTOMER_ADMIN_ID,
        }),
      },
      {
        new: true,
        runValidators: true,
      },
    )
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_STATE_MUTATED',
      resourceType: 'RuntimeInstance',
      resourceId: RUNTIME_INSTANCE_ID,
      scope: expect.objectContaining({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        runtimeInstanceId: RUNTIME_INSTANCE_ID,
        runtimeInstanceKey: 'value-narrative-439111',
      }),
      diff: expect.objectContaining({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        previousValue: 'Proposal creation is slow.',
        nextValue: 'Proposal teams lack a shared story.',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      }),
    }))
    expect(res.body.data.mutation).toEqual({
      runtimePath: 'framework_state.sections.customer_problem',
      operation: 'WRITE',
      previousValue: 'Proposal creation is slow.',
      value: 'Proposal teams lack a shared story.',
    })
    expect(res.body.data.advance).toBeUndefined()
  })

  test('PATCH /api/v1/runtime-instances/:id/data returns server-owned advance when Save and Next is requested', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
        }),
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
        },
        {
          sectionKey: 'internal_hidden',
          runtimePath: 'framework_state.sections.internal_hidden',
          required: true,
        },
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
        },
      ],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-internal-hidden',
        pathKey: 'framework_state.sections.internal_hidden',
        label: 'Internal Hidden',
        displayOrder: 20,
      }),
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-value-drivers',
        pathKey: 'framework_state.sections.value_drivers',
        label: 'Value Drivers',
        displayOrder: 30,
      }),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        makeUIContract().sections[0],
        {
          sectionKey: 'internal_hidden',
          runtimePath: 'framework_state.sections.internal_hidden',
          source: 'PACKAGE',
          isCustom: false,
          label: 'Internal Hidden',
          displayOrder: 20,
          isVisible: false,
          isEditable: true,
          isRequiredDisplay: true,
          isReadOnlyDisplay: false,
        },
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          source: 'PACKAGE',
          isCustom: false,
          label: 'Value Drivers',
          displayOrder: 30,
          isVisible: true,
          isEditable: true,
          isRequiredDisplay: true,
          isReadOnlyDisplay: false,
        },
      ],
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Proposal teams lack a shared story.',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        saveAndNext: true,
      })

    expect(res.status).toBe(200)
    expect(FrameworkPackage.findById).toHaveBeenCalledWith(FRAMEWORK_PACKAGE_ID)
    expect(res.body.data.advance).toEqual({
      requested: true,
      hasNext: true,
      currentRuntimePath: 'framework_state.sections.customer_problem',
      currentSectionKey: 'customer_problem',
      nextRuntimePath: 'framework_state.sections.value_drivers',
      nextSectionKey: 'value_drivers',
      reason: '',
    })
  })

  test('PATCH /api/v1/runtime-instances/:id/data returns terminal advance when no next rendered section exists', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Proposal teams lack a shared story.',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        saveAndNext: true,
      })

    expect(res.status).toBe(200)
    expect(res.body.data.advance).toEqual({
      requested: true,
      hasNext: false,
      currentRuntimePath: 'framework_state.sections.customer_problem',
      currentSectionKey: 'customer_problem',
      nextRuntimePath: '',
      nextSectionKey: '',
      reason: 'END_OF_GUIDED_SECTIONS',
    })
  })

  test('PATCH /api/v1/runtime-instances/:id/data does not advance from a current section the renderer would not project', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([]))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
        },
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
        },
      ],
    }))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Proposal teams lack a shared story.',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        saveAndNext: true,
      })

    expect(res.status).toBe(200)
    expect(res.body.data.advance).toEqual({
      requested: true,
      hasNext: false,
      currentRuntimePath: 'framework_state.sections.customer_problem',
      currentSectionKey: 'customer_problem',
      nextRuntimePath: '',
      nextSectionKey: '',
      reason: 'CURRENT_SECTION_NOT_PROJECTABLE',
    })
  })

  test('PATCH /api/v1/runtime-instances/:id/data invalidates validation and readiness evidence after a section write', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'READY' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'READY',
          ready: true,
          validationState: 'PASSED',
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: '',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: expect.objectContaining({
          framework_state: expect.objectContaining({
            validation: {},
            readiness: expect.objectContaining({
              state: 'DRAFT',
              ready: false,
              submittedForReview: false,
              validationState: 'UNKNOWN',
              invalidatedByRuntimePath: 'framework_state.sections.customer_problem',
              invalidatedAt: expect.any(String),
            }),
          }),
        }),
      },
      expect.any(Object),
    )
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-inputs persists a real evidence pack with audit', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: {},
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = buildRuntimePathFindOneMock([
      makeEvidencePackRuntimePathRecord(),
      makeRuntimePathRecord(),
    ])
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-hidden-secret',
        pathKey: 'framework_state.sections.hidden_secret',
        label: 'Hidden Secret',
        allowedOperations: ['READ', 'WRITE'],
        displayOrder: 20,
      }),
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-write-only',
        pathKey: 'framework_state.sections.write_only',
        label: 'Write Only',
        allowedOperations: ['WRITE'],
        displayOrder: 30,
      }),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          displayOrder: 10,
          isVisible: true,
        },
        {
          sectionKey: 'hidden_secret',
          runtimePath: 'framework_state.sections.hidden_secret',
          displayOrder: 20,
          isVisible: false,
        },
      ],
    })))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
        },
        {
          sectionKey: 'hidden_secret',
          runtimePath: 'framework_state.sections.hidden_secret',
          required: false,
        },
        {
          sectionKey: 'write_only',
          runtimePath: 'framework_state.sections.write_only',
          required: false,
        },
        {
          sectionKey: 'unregistered',
          runtimePath: 'framework_state.sections.unregistered',
          required: false,
        },
      ],
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        acquisitionProfile: 'STANDARD',
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
          notes: 'Use only customer-provided discovery context.',
        },
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(200)
    const persistedEvidencePack = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.evidence_pack
    expect(persistedEvidencePack).toEqual(expect.objectContaining({
      inputComplete: true,
      evidenceReady: true,
      accepted: false,
      needsRefresh: false,
      acquisitionProfile: 'STANDARD',
      acquisition: expect.objectContaining({
        profile: 'STANDARD',
        status: 'EVIDENCE_READY',
        evidenceTarget: { min: 5, max: 20 },
        enabledSourceTypes: ['DISCOVERY_INPUTS', 'USER_PROVIDED_WEBSITE', 'UPLOADED_DOCUMENTS'],
        reservedSourceTypes: [],
        disabledProfiles: [
          expect.objectContaining({ profile: 'STRATEGIC' }),
        ],
        coverage: expect.objectContaining({
          status: 'SUFFICIENT_FOR_FRAMEWORK',
          score: 100,
          evidenceObjectCount: 5,
          acceptedEvidenceCount: 0,
          pendingReviewCount: 5,
          rejectedEvidenceCount: 0,
        }),
        confidence: expect.objectContaining({
          level: 'STANDARD',
        }),
      }),
      inputs: {
        companyWebsite: 'https://acme.example',
        companyName: 'Acme',
        marketRegion: 'UK enterprise',
        targetOffer: 'Managed proposal platform',
        notes: 'Use only customer-provided discovery context.',
      },
      evidence: expect.objectContaining({
        source: 'DISCOVERY_INPUTS',
        inputKeys: ['companyWebsite', 'companyName', 'marketRegion', 'targetOffer', 'notes'],
        missingInputKeys: [],
        reviewSummary: {
          evidenceObjectCount: 5,
          acceptedEvidenceCount: 0,
          pendingReviewCount: 5,
          rejectedEvidenceCount: 0,
        },
        sourceRefs: [
          'input_companyWebsite',
          'input_companyName',
          'input_marketRegion',
          'input_targetOffer',
          'input_notes',
        ],
      }),
      summaries: {
        compact: expect.objectContaining({
          confidence: 'USER_PROVIDED',
        }),
      },
      scoped_views: {
        customer_problem: expect.objectContaining({
          source: 'DISCOVERY_EVIDENCE_PACK',
          inputKeys: ['companyWebsite', 'companyName', 'marketRegion', 'targetOffer', 'notes'],
        }),
      },
      lineage: expect.objectContaining({
        sources: expect.arrayContaining([
          expect.objectContaining({
            sourceId: 'input_companyWebsite',
            type: 'USER_PROVIDED_WEBSITE',
            status: 'USER_PROVIDED',
            acquisitionProfile: 'STANDARD',
          }),
        ]),
        builder: expect.objectContaining({
          adapter: 'customer-input',
          acquisitionProfile: 'STANDARD',
        }),
      }),
      revisions: [
        expect.objectContaining({
          reason: 'SAVE_DISCOVERY_INPUTS',
          inputHash: expect.stringMatching(/^sha256:/),
          evidenceHash: expect.stringMatching(/^sha256:/),
        }),
      ],
    }))
    expect(persistedEvidencePack.sourceRegistry).toHaveLength(5)
    expect(persistedEvidencePack.sourceRegistry).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: 'input_companyWebsite',
        sourceType: 'WEBSITE',
        acquisitionStatus: 'CAPTURED',
        evidenceProduced: 1,
        fieldKey: 'companyWebsite',
        url: 'https://acme.example',
      }),
      expect.objectContaining({
        sourceId: 'input_targetOffer',
        sourceType: 'DISCOVERY_NOTES',
        acquisitionStatus: 'CAPTURED',
        evidenceProduced: 1,
        fieldKey: 'targetOffer',
      }),
    ]))
    expect(persistedEvidencePack.evidenceObjects).toHaveLength(5)
    expect(persistedEvidencePack.evidenceObjects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: 'input_companyWebsite',
        category: 'Company',
        coverageArea: 'Company',
        reviewStatus: 'PENDING',
        acquisitionMethod: 'CUSTOMER_PROVIDED_INPUT',
        extractedFact: 'Company website: https://acme.example',
      }),
      expect.objectContaining({
        sourceId: 'input_notes',
        category: 'Value Drivers',
        coverageArea: 'Decision Context',
        reviewStatus: 'PENDING',
        acquisitionMethod: 'CUSTOMER_PROVIDED_INPUT',
        extractedFact: 'Intelligence Hub note: Use only customer-provided discovery context.',
      }),
    ]))
    expect(persistedEvidencePack.discoveryHealth).toEqual(expect.objectContaining({
      evidenceObjectCount: 5,
      acceptedEvidenceCount: 0,
      pendingReviewCount: 5,
      rejectedEvidenceCount: 0,
      sourceCount: 5,
      acquisitionProfile: 'STANDARD',
    }))
    expect(persistedEvidencePack.scoped_views.hidden_secret).toBeUndefined()
    expect(persistedEvidencePack.scoped_views.write_only).toBeUndefined()
    expect(persistedEvidencePack.scoped_views.unregistered).toBeUndefined()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_STATE_MUTATED',
      resourceType: 'RuntimeInstance',
      resourceId: RUNTIME_INSTANCE_ID,
      diff: expect.objectContaining({
        runtimePath: 'framework_state.evidence_pack',
        operation: 'WRITE',
        previousValue: {},
        nextValue: expect.objectContaining({
          inputComplete: true,
          evidenceReady: true,
        }),
      }),
    }))
    expect(res.body.data.discovery).toEqual(expect.objectContaining({
      inputComplete: true,
      evidenceReady: true,
      accepted: false,
      needsRefresh: false,
      acquisitionProfile: 'STANDARD',
      inputSummary: {
        keys: ['companyWebsite', 'companyName', 'marketRegion', 'targetOffer', 'notes'],
        count: 5,
      },
      scopedViewSummary: {
        keys: ['customer_problem'],
        count: 1,
      },
      sourceRegistrySummary: {
        count: 5,
        sourceTypes: ['WEBSITE', 'DISCOVERY_NOTES'],
      },
      evidenceObjectSummary: {
        evidenceObjectCount: 5,
        acceptedEvidenceCount: 0,
        pendingReviewCount: 5,
        rejectedEvidenceCount: 0,
      },
      discoveryHealth: expect.objectContaining({
        evidenceObjectCount: 5,
        pendingReviewCount: 5,
      }),
    }))
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-inputs acquires multiple Standard website sources deterministically', async () => {
    mockEnhancedWebsiteFetch({ html: STYLE_ARTIFACT_WEBSITE_HTML })
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: {},
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeEvidencePackRuntimePathRecord(),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          displayOrder: 10,
          isVisible: true,
        },
      ],
    })))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
        },
      ],
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        acquisitionProfile: 'STANDARD',
        inputs: {
          websiteSources: [
            'https://acme.example',
            'https://acme.example/product',
          ],
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(200)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    const persistedEvidencePack = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.evidence_pack
    const websiteSources = persistedEvidencePack.sourceRegistry.filter((source) =>
      source.sourceId.startsWith('website_') && source.sourceType === 'WEBSITE')
    const websiteEvidenceObjects = persistedEvidencePack.evidenceObjects.filter((evidenceObject) =>
      evidenceObject.acquisitionMethod === 'WEBSITE_ACQUISITION')

    expect(persistedEvidencePack.inputs).toEqual(expect.objectContaining({
      companyWebsite: 'https://acme.example/',
      websiteSources: [
        'https://acme.example/',
        'https://acme.example/product',
      ],
      companyName: 'Acme',
      marketRegion: 'UK enterprise',
      targetOffer: 'Managed proposal platform',
    }))
    expect(persistedEvidencePack.acquisition).toEqual(expect.objectContaining({
      profile: 'STANDARD',
      confidence: expect.objectContaining({
        level: 'SOURCE_BACKED',
        basis: expect.arrayContaining([
          'CUSTOMER_WEBSITE_ACQUISITION',
          'DETERMINISTIC_TEXT_EXTRACTION',
          'EVIDENCE_REVIEW_PENDING',
        ]),
      }),
      websiteAcquisition: expect.objectContaining({
        status: 'ACQUIRED',
        sourceCount: 2,
        acquiredSourceCount: 2,
        failedSourceCount: 0,
        evidenceProduced: websiteEvidenceObjects.length,
      }),
    }))
    expect(persistedEvidencePack.evidence).toEqual(expect.objectContaining({
      source: 'DISCOVERY_INPUTS_AND_WEBSITE_ACQUISITION',
      inputKeys: ['companyWebsite', 'companyName', 'marketRegion', 'targetOffer', 'websiteSources'],
    }))
    expect(websiteSources).toHaveLength(2)
    expect(websiteSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Website Source',
        acquisitionStatus: 'ACQUIRED',
        evidenceProduced: expect.any(Number),
        url: 'https://acme.example/',
      }),
      expect.objectContaining({
        label: 'Website Source',
        acquisitionStatus: 'ACQUIRED',
        evidenceProduced: expect.any(Number),
        url: 'https://acme.example/product',
      }),
    ]))
    expect(websiteEvidenceObjects.length).toBeGreaterThan(0)
    expect(websiteEvidenceObjects.map((evidenceObject) => evidenceObject.extractedFact).join(' ')).toContain(
      'governed value narratives',
    )
    expect(websiteEvidenceObjects).toEqual(expect.not.arrayContaining([
      expect.objectContaining({
        extractedFact: expect.stringMatching(/StylableButton|box-sizing|width:100%|var\(--|PnnIOa|:hover|cubic-bezier|transition:all|spC4EKo|:focus|box-shadow/),
      }),
    ]))
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-inputs rejects Standard website sources without https', async () => {
    RuntimeInstance.findOne = jest.fn()
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        acquisitionProfile: 'STANDARD',
        inputs: {
          websiteSources: ['www.acme.example'],
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(422)
    expect(res.body.error).toEqual(expect.objectContaining({
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed.',
    }))
    expect(JSON.stringify(res.body.error.details)).toContain('Enter the full URL including https://')
    expect(RuntimeInstance.findOne).not.toHaveBeenCalled()
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-inputs rejects Standard website sources in non-public direct IP ranges', async () => {
    RuntimeInstance.findOne = jest.fn()
    globalThis.fetch = jest.fn()
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        acquisitionProfile: 'STANDARD',
        inputs: {
          websiteSources: ['https://100.64.0.1/customer'],
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(422)
    expect(JSON.stringify(res.body.error.details)).toContain('Website source must be a publicly accessible domain.')
    expect(RuntimeInstance.findOne).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-inputs runs Enhanced website acquisition with source-backed evidence', async () => {
    mockEnhancedWebsiteFetch()
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: {},
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeEvidencePackRuntimePathRecord(),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          displayOrder: 10,
          isVisible: true,
        },
      ],
    })))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
        },
      ],
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        acquisitionProfile: 'ENHANCED',
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
          notes: 'Use customer-owned website evidence.',
        },
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(200)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://acme.example/',
      expect.objectContaining({
        redirect: 'manual',
        headers: expect.objectContaining({
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.8',
        }),
      }),
    )
    const persistedEvidencePack = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.evidence_pack
    const websiteSource = persistedEvidencePack.sourceRegistry.find((source) =>
      source.sourceId.startsWith('website_'))
    const websiteEvidenceObjects = persistedEvidencePack.evidenceObjects.filter((evidenceObject) =>
      evidenceObject.acquisitionMethod === 'WEBSITE_ACQUISITION')

    expect(persistedEvidencePack).toEqual(expect.objectContaining({
      acquisitionProfile: 'ENHANCED',
      inputComplete: true,
      evidenceReady: true,
      accepted: false,
      acquisition: expect.objectContaining({
        profile: 'ENHANCED',
        status: 'EVIDENCE_READY',
        evidenceTarget: { min: 20, max: 100 },
        enabledSourceTypes: ['DISCOVERY_INPUTS', 'WEBSITE', 'UPLOADED_DOCUMENTS'],
        reservedSourceTypes: ['ADDITIONAL_WEBSITE_PAGES'],
        disabledProfiles: [
          expect.objectContaining({ profile: 'STRATEGIC' }),
        ],
        websiteAcquisition: expect.objectContaining({
          status: 'ACQUIRED',
          evidenceProduced: websiteEvidenceObjects.length,
          url: 'https://acme.example/',
        }),
        coverage: expect.objectContaining({
          status: 'SOURCE_BACKED_EVIDENCE_READY',
          evidenceObjectCount: persistedEvidencePack.evidenceObjects.length,
          acceptedEvidenceCount: 0,
          pendingReviewCount: persistedEvidencePack.evidenceObjects.length,
        }),
        confidence: expect.objectContaining({
          level: 'SOURCE_BACKED',
          basis: expect.arrayContaining(['CUSTOMER_WEBSITE_ACQUISITION']),
        }),
      }),
      evidence: expect.objectContaining({
        source: 'DISCOVERY_INPUTS_AND_WEBSITE_ACQUISITION',
        acquisitionProfile: 'ENHANCED',
      }),
      lineage: expect.objectContaining({
        sources: expect.arrayContaining([
          expect.objectContaining({
            sourceId: expect.stringMatching(/^website_/),
            type: 'WEBSITE_ACQUISITION',
            status: 'ACQUIRED',
            adapter: 'website-html-fetch-v1',
            acquisitionProfile: 'ENHANCED',
          }),
        ]),
        builder: expect.objectContaining({
          mode: 'DETERMINISTIC_WEBSITE_ACQUISITION',
          adapter: 'customer-input+website-html-fetch',
          acquisitionProfile: 'ENHANCED',
        }),
      }),
    }))
    expect(websiteSource).toEqual(expect.objectContaining({
      sourceType: 'WEBSITE',
      label: 'Website Source',
      acquisitionStatus: 'ACQUIRED',
      evidenceProduced: websiteEvidenceObjects.length,
      url: 'https://acme.example/',
    }))
    expect(websiteEvidenceObjects.length).toBeGreaterThan(0)
    expect(websiteEvidenceObjects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: websiteSource.sourceId,
        reviewStatus: 'PENDING',
        confidence: expect.objectContaining({
          level: 'SOURCE_BACKED',
        }),
        extractedFact: expect.stringContaining('Website'),
      }),
    ]))
    expect(persistedEvidencePack.discoveryHealth).toEqual(expect.objectContaining({
      acquisitionProfile: 'ENHANCED',
      evidenceObjectCount: persistedEvidencePack.evidenceObjects.length,
      sourceCount: persistedEvidencePack.sourceRegistry.length,
      confidence: 'SOURCE_BACKED',
    }))
    expect(JSON.stringify(persistedEvidencePack)).not.toContain('<html>')
    expect(res.body.data.discovery).toEqual(expect.objectContaining({
      acquisitionProfile: 'ENHANCED',
      sourceRegistrySummary: {
        count: persistedEvidencePack.sourceRegistry.length,
        sourceTypes: ['WEBSITE', 'DISCOVERY_NOTES'],
      },
      evidenceObjectSummary: expect.objectContaining({
        evidenceObjectCount: persistedEvidencePack.evidenceObjects.length,
        pendingReviewCount: persistedEvidencePack.evidenceObjects.length,
      }),
      discoveryHealth: expect.objectContaining({
        confidence: 'SOURCE_BACKED',
      }),
    }))
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-inputs ingests uploaded TXT document into governed Evidence Objects', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: {},
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeEvidencePackRuntimePathRecord(),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          displayOrder: 10,
          isVisible: true,
        },
      ],
    })))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
        },
      ],
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())
    const documentText = [
      'Customer proposal teams need governed AI workflow automation for enterprise value narratives.',
      'The implementation documentation describes reusable commercial outputs and improved productivity.',
      'Do not persist this as raw uploaded document text.',
    ].join('\n')

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        acquisitionProfile: 'STANDARD',
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
        documentSources: [
          {
            fileName: 'customer-discovery-notes.txt',
            mimeType: 'text/plain',
            assetType: 'CUSTOMER_NOTES',
            sizeBytes: Buffer.byteLength(documentText),
            textContent: documentText,
          },
        ],
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(200)
    const persistedEvidencePack = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.evidence_pack
    const documentSource = persistedEvidencePack.sourceRegistry.find((source) =>
      source.sourceType === 'UPLOADED_DOCUMENT')
    const documentEvidenceObjects = persistedEvidencePack.evidenceObjects.filter((evidenceObject) =>
      evidenceObject.acquisitionMethod === 'DOCUMENT_INGESTION')

    expect(persistedEvidencePack.evidence.source).toBe('DISCOVERY_INPUTS_AND_DOCUMENT_INGESTION')
    expect(persistedEvidencePack.acquisition).toEqual(expect.objectContaining({
      documentAcquisition: {
        status: 'ACQUIRED',
        sourceCount: 1,
        evidenceProduced: documentEvidenceObjects.length,
      },
      confidence: expect.objectContaining({
        level: 'SOURCE_BACKED',
        basis: expect.arrayContaining(['UPLOADED_DOCUMENT_INGESTION']),
      }),
    }))
    expect(documentSource).toEqual(expect.objectContaining({
      sourceType: 'UPLOADED_DOCUMENT',
      label: 'Customer Notes: customer-discovery-notes.txt',
      acquisitionStatus: 'ACQUIRED',
      evidenceProduced: documentEvidenceObjects.length,
      fileName: 'customer-discovery-notes.txt',
      mimeType: 'text/plain',
      documentType: 'TXT',
      assetType: 'CUSTOMER_NOTES',
      documentHash: expect.stringMatching(/^sha256:/),
    }))
    expect(documentEvidenceObjects.length).toBeGreaterThan(0)
    expect(documentEvidenceObjects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: documentSource.sourceId,
        reviewStatus: 'PENDING',
        acquisitionMethod: 'DOCUMENT_INGESTION',
        confidence: expect.objectContaining({
          level: 'SOURCE_BACKED',
          basis: expect.arrayContaining(['UPLOADED_DOCUMENT']),
        }),
        extractedFact: expect.stringContaining('Document Customer Notes:'),
        sourceFileName: 'customer-discovery-notes.txt',
        documentAssetType: 'CUSTOMER_NOTES',
      }),
    ]))
    expect(JSON.stringify(persistedEvidencePack.lineage.sources)).not.toContain(documentText)
    expect(JSON.stringify(persistedEvidencePack.lineage.sources)).not.toContain('textContent')
    expect(JSON.stringify(persistedEvidencePack.lineage.sources)).not.toContain('contentBase64')
    expect(res.body.data.discovery).toEqual(expect.objectContaining({
      sourceRegistrySummary: {
        count: 5,
        sourceTypes: ['WEBSITE', 'DISCOVERY_NOTES', 'UPLOADED_DOCUMENT'],
      },
      evidenceObjectSummary: expect.objectContaining({
        evidenceObjectCount: persistedEvidencePack.evidenceObjects.length,
        pendingReviewCount: persistedEvidencePack.evidenceObjects.length,
      }),
    }))
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-inputs ingests DOCX documents whose ZIP sizes are stored in the central directory', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: {},
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeEvidencePackRuntimePathRecord(),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          displayOrder: 10,
          isVisible: true,
        },
      ],
    })))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
        },
      ],
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())
    const documentText = 'StorylineOS strategic implications include governed value narrative creation, source-backed commercial intelligence, and reusable executive-ready messaging for enterprise teams.'
    const docxBuffer = buildDocxBufferWithDataDescriptor(documentText)

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        acquisitionProfile: 'STANDARD',
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
        documentSources: [
          {
            fileName: 'customer-strategy.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            assetType: 'CUSTOMER_DOCUMENT',
            sizeBytes: docxBuffer.length,
            contentBase64: docxBuffer.toString('base64'),
          },
        ],
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(200)
    const persistedEvidencePack = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.evidence_pack
    const documentSource = persistedEvidencePack.sourceRegistry.find((source) =>
      source.sourceType === 'UPLOADED_DOCUMENT')
    const documentEvidenceObjects = persistedEvidencePack.evidenceObjects.filter((evidenceObject) =>
      evidenceObject.acquisitionMethod === 'DOCUMENT_INGESTION')

    expect(documentSource).toEqual(expect.objectContaining({
      sourceType: 'UPLOADED_DOCUMENT',
      label: 'Customer Document: customer-strategy.docx',
      acquisitionStatus: 'ACQUIRED',
      fileName: 'customer-strategy.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      documentType: 'DOCX',
      documentStatus: 'PROCESSED',
      evidenceProduced: documentEvidenceObjects.length,
    }))
    expect(documentEvidenceObjects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        extractedFact: expect.stringContaining('governed value narrative creation'),
      }),
    ]))
    expect(JSON.stringify(persistedEvidencePack)).not.toContain('contentBase64')
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-inputs appends uploaded documents to the existing document registry', async () => {
    const previousDocumentSourceId = 'document_previous_pdf'
    const previousDocumentEvidenceObject = makeDiscoveryEvidenceObject({
      evidenceObjectId: 'evidence_previous_pdf_fixture',
      sourceId: previousDocumentSourceId,
      category: 'Value Drivers',
      coverageArea: 'Decision Context',
      extractedFact: 'Document Customer Document: Previous PDF evidence remains available.',
      reviewStatus: 'ACCEPTED',
      acquisitionMethod: 'DOCUMENT_INGESTION',
      confidence: {
        level: 'SOURCE_BACKED',
        score: 74,
        basis: ['UPLOADED_DOCUMENT', 'DETERMINISTIC_TEXT_EXTRACTION'],
      },
      sourceFileName: 'previous-brief.pdf',
      documentAssetType: 'CUSTOMER_DOCUMENT',
      lineageRef: `lineage:${previousDocumentSourceId}:fixture`,
    })
    const previousDocumentRegistryEntry = makeDiscoverySourceRegistryEntry({
      sourceId: previousDocumentSourceId,
      sourceType: 'UPLOADED_DOCUMENT',
      label: 'Customer Document: previous-brief.pdf',
      acquisitionStatus: 'ACQUIRED',
      evidenceProduced: 1,
      evidenceObjectsGenerated: 1,
      acceptedEvidenceObjects: 1,
      pendingEvidenceObjects: 0,
      rejectedEvidenceObjects: 0,
      fileName: 'previous-brief.pdf',
      mimeType: 'application/pdf',
      documentType: 'PDF',
      assetType: 'CUSTOMER_DOCUMENT',
      documentStatus: 'PROCESSED',
      documentHash: 'sha256:previous-pdf-hash',
      uploadedAt: '2026-05-19T07:55:00.000Z',
      lineageRef: `lineage:${previousDocumentSourceId}`,
      fieldKey: undefined,
      url: undefined,
    })
    const previousEvidencePack = makeReviewableDiscoveryEvidencePack({
      evidenceObjects: [previousDocumentEvidenceObject],
      sourceRegistry: [previousDocumentRegistryEntry],
      lineage: {
        sources: [
          {
            sourceId: previousDocumentSourceId,
            documentId: previousDocumentSourceId,
            type: 'UPLOADED_DOCUMENT',
            sourceType: 'UPLOADED_DOCUMENT',
            label: 'Customer Document: previous-brief.pdf',
            fileName: 'previous-brief.pdf',
            mimeType: 'application/pdf',
            documentType: 'PDF',
            assetType: 'CUSTOMER_DOCUMENT',
            sizeBytes: 1200,
            documentHash: 'sha256:previous-pdf-hash',
            documentStatus: 'PROCESSED',
            uploadedAt: '2026-05-19T07:55:00.000Z',
            status: 'ACQUIRED',
            acquisitionStatus: 'ACQUIRED',
            acquisitionProfile: 'STANDARD',
            evidenceProduced: 1,
            lineageRef: `lineage:${previousDocumentSourceId}`,
          },
        ],
        builder: {
          mode: 'DETERMINISTIC',
          version: 'discovery-evidence-pack-v1',
          adapter: 'customer-input',
        },
      },
    })
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: previousEvidencePack,
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeEvidencePackRuntimePathRecord(),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          displayOrder: 10,
          isVisible: true,
        },
      ],
    })))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
        },
      ],
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())
    const documentText = [
      'New customer notes describe governed section intelligence and reusable executive value narratives.',
      'The uploaded notes should be added to the existing document register rather than replacing it.',
    ].join('\n')

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        acquisitionProfile: 'STANDARD',
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
        documentSources: [
          {
            fileName: 'new-discovery-notes.txt',
            mimeType: 'text/plain',
            assetType: 'CUSTOMER_NOTES',
            sizeBytes: Buffer.byteLength(documentText),
            textContent: documentText,
          },
        ],
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(200)
    const persistedEvidencePack = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.evidence_pack
    const documentRegistryEntries = persistedEvidencePack.sourceRegistry.filter((source) =>
      source.sourceType === 'UPLOADED_DOCUMENT')
    const documentLineageSources = persistedEvidencePack.lineage.sources.filter((source) =>
      source.type === 'UPLOADED_DOCUMENT' || source.sourceType === 'UPLOADED_DOCUMENT')
    const documentEvidenceObjects = persistedEvidencePack.evidenceObjects.filter((evidenceObject) =>
      evidenceObject.acquisitionMethod === 'DOCUMENT_INGESTION')

    expect(documentRegistryEntries).toHaveLength(2)
    expect(documentLineageSources).toHaveLength(2)
    expect(documentRegistryEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: previousDocumentSourceId,
        fileName: 'previous-brief.pdf',
        documentType: 'PDF',
      }),
      expect.objectContaining({
        fileName: 'new-discovery-notes.txt',
        documentType: 'TXT',
      }),
    ]))
    expect(documentEvidenceObjects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidenceObjectId: 'evidence_previous_pdf_fixture',
        sourceId: previousDocumentSourceId,
        reviewStatus: 'ACCEPTED',
      }),
      expect.objectContaining({
        sourceFileName: 'new-discovery-notes.txt',
        reviewStatus: 'PENDING',
      }),
    ]))
    expect(persistedEvidencePack.acquisition.documentAcquisition).toEqual({
      status: 'ACQUIRED',
      sourceCount: 2,
      evidenceProduced: documentEvidenceObjects.length,
    })
    expect(persistedEvidencePack.evidence.source).toBe('DISCOVERY_INPUTS_AND_DOCUMENT_INGESTION')
    expect(JSON.stringify(persistedEvidencePack)).not.toContain('textContent')
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-inputs fails closed for unsupported document types', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        acquisitionProfile: 'STANDARD',
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
        documentSources: [
          {
            fileName: 'customer-evidence.exe',
            mimeType: 'application/octet-stream',
            sizeBytes: 120,
            textContent: 'Unsupported content should not become evidence.',
          },
        ],
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(422)
    expect(res.body.error).toEqual(expect.objectContaining({
      code: 'VALIDATION_FAILED',
      message: 'Document ingestion could not produce governed evidence.',
    }))
    expect(res.body.error.details).toEqual(expect.objectContaining({
      reason: 'DOCUMENT_INGESTION_FAILED',
      acquisitionStatus: 'FAILED',
      acquisitionError: 'Uploaded document must be PDF, DOCX, or TXT.',
    }))
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_STATE_MUTATED',
    }))
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-inputs fails closed when Enhanced website acquisition redirects off-domain', async () => {
    mockEnhancedWebsiteFetch({ url: 'https://other.example/' })
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        acquisitionProfile: 'ENHANCED',
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(422)
    expect(res.body.error).toEqual(expect.objectContaining({
      code: 'VALIDATION_FAILED',
      message: 'Enhanced Acquisition could not acquire website evidence.',
    }))
    expect(res.body.error.details).toEqual(expect.objectContaining({
      reason: 'WEBSITE_ACQUISITION_FAILED',
      acquisitionProfile: 'ENHANCED',
      acquisitionStatus: 'FAILED',
    }))
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_STATE_MUTATED',
    }))
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-inputs fails closed when Enhanced website DNS resolves to a private target', async () => {
    mockEnhancedWebsiteFetch()
    globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = jest.fn(async () => [
      { address: '10.0.0.5', family: 4 },
    ])
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        acquisitionProfile: 'ENHANCED',
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(422)
    expect(res.body.error).toEqual(expect.objectContaining({
      code: 'VALIDATION_FAILED',
      message: 'Enhanced Acquisition could not acquire website evidence.',
    }))
    expect(res.body.error.details).toEqual(expect.objectContaining({
      reason: 'WEBSITE_ACQUISITION_FAILED',
      acquisitionProfile: 'ENHANCED',
      acquisitionStatus: 'FAILED',
    }))
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_STATE_MUTATED',
    }))
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-inputs samples oversized Enhanced website content within the streaming cap', async () => {
    globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = jest.fn(async () => [
      { address: '93.184.216.34', family: 4 },
    ])
    const encoder = new TextEncoder()
    const oversizedHtml = `
      <html>
        <head>
          <title>Acme governed proposal platform</title>
          <meta name="description" content="Acme helps enterprise sales teams improve proposal governance and revenue productivity.">
        </head>
        <body>
          <h1>AI proposal automation platform</h1>
          <p>Acme helps enterprise teams produce governed commercial narratives from customer evidence.</p>
          ${'x'.repeat(340000)}
        </body>
      </html>
    `
    const textReader = {
      read: jest.fn()
        .mockResolvedValueOnce({ done: false, value: encoder.encode(oversizedHtml) })
        .mockResolvedValueOnce({ done: true }),
      cancel: jest.fn(async () => {}),
      releaseLock: jest.fn(),
    }
    const textFallback = jest.fn()
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      url: 'https://acme.example/',
      headers: {
        get: jest.fn((key) => (String(key).toLowerCase() === 'content-type' ? 'text/html' : '')),
      },
      body: {
        getReader: () => textReader,
      },
      text: textFallback,
    }))
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeEvidencePackRuntimePathRecord(),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          displayOrder: 10,
          isVisible: true,
        },
      ],
    })))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
        },
      ],
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        acquisitionProfile: 'ENHANCED',
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(200)
    const persistedEvidencePack = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.evidence_pack
    const websiteSource = persistedEvidencePack.sourceRegistry.find((source) =>
      source.sourceId.startsWith('website_'))
    const websiteEvidenceObjects = persistedEvidencePack.evidenceObjects.filter((evidenceObject) =>
      evidenceObject.acquisitionMethod === 'WEBSITE_ACQUISITION')

    expect(websiteEvidenceObjects.length).toBeGreaterThan(0)
    expect(websiteSource).toEqual(expect.objectContaining({
      acquisitionStatus: 'ACQUIRED',
      contentTruncated: true,
      contentCharacterLimit: 320000,
      contentCharactersRead: 320000,
    }))
    expect(persistedEvidencePack.acquisition.websiteAcquisition).toEqual(expect.objectContaining({
      status: 'ACQUIRED',
      evidenceProduced: websiteEvidenceObjects.length,
    }))
    expect(textReader.cancel).toHaveBeenCalled()
    expect(textFallback).not.toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_STATE_MUTATED',
    }))
  })

  test.each(['STRATEGIC'])(
    'PATCH /api/v1/runtime-instances/:id/discovery-inputs rejects reserved %s Acquisition',
    async (acquisitionProfile) => {
      RuntimeInstance.findOne = jest.fn()
      const token = await getAccessTokenForUser(makeCustomerAdmin())

      const res = await request
        .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          acquisitionProfile,
          inputs: {
            companyWebsite: 'https://acme.example',
            companyName: 'Acme',
            marketRegion: 'UK enterprise',
            targetOffer: 'Managed proposal platform',
          },
          expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        })

      expect(res.status).toBe(422)
      expect(res.body.error).toEqual(expect.objectContaining({
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed.',
      }))
      expect(res.body.error.details.acquisitionProfile).toBe(
        'acquisitionProfile must be STANDARD or ENHANCED. STRATEGIC is not available in this sprint.',
      )
      expect(RuntimeInstance.findOne).not.toHaveBeenCalled()
    },
  )

  test.each([
    ['missing registry path', null, 'is not registered'],
    ['read-only registry path', makeEvidencePackRuntimePathRecord({ allowedOperations: ['READ'] }), 'does not allow WRITE'],
    ['protected registry path', makeEvidencePackRuntimePathRecord({ isProtected: true }), 'protected from runtime writes'],
  ])('rejects discovery input writes when the evidence pack path is %s', async (_caseName, pathRecord, messageFragment) => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(pathRecord))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_INVALID_PATH')
    expect(res.body.error.details.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringContaining(messageFragment),
      }),
    ]))
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects stale discovery input writes before state or audit persistence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:30:00.000Z'),
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_STALE')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects discovery input writes when the actor lacks mutation access', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    const token = await getAccessTokenForUser(makeRegularUser())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(403)
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects undocumented discovery refresh flags', async () => {
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        refreshEvidence: false,
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details._root).toContain('Unrecognized key')
    expect(RuntimeInstance.findOne).not.toHaveBeenCalled()
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('discovery input writes with incomplete required inputs persist input-required evidence without scoped views', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        inputs: {
          companyName: 'Acme',
        },
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(200)
    const persistedEvidencePack = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.evidence_pack
    expect(persistedEvidencePack).toEqual(expect.objectContaining({
      inputComplete: false,
      evidenceReady: false,
      accepted: false,
      scoped_views: {},
      state: expect.objectContaining({
        status: 'INPUT_REQUIRED',
      }),
      evidence: expect.objectContaining({
        missingInputKeys: ['companyWebsite', 'marketRegion', 'targetOffer'],
      }),
    }))
    expect(res.body.data.discovery).toEqual(expect.objectContaining({
      inputComplete: false,
      evidenceReady: false,
      scopedViewSummary: {
        keys: [],
        count: 0,
      },
    }))
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_STATE_MUTATED',
    }))
  })

  test('rolls back discovery input writes when audit persistence fails', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: {},
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        framework_state: {
          ...runtimeInstanceDoc.framework_state,
          evidence_pack: {
            inputComplete: true,
            evidenceReady: true,
          },
        },
        updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      }))
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        updatedAt: new Date('2026-05-19T08:02:00.000Z'),
      }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    AuditLog.createLog = jest.fn(async () => {
      throw new Error('audit unavailable')
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('RUNTIME_STATE_MUTATION_AUDIT_FAILED')
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_AUDIT_PERSISTENCE_FAILED')
    expect(res.body.error.details.auditError).toEqual(expect.objectContaining({
      name: 'Error',
      message: 'audit unavailable',
    }))
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(RuntimeInstance.findOneAndUpdate.mock.calls[1]).toEqual([
      {
        _id: RUNTIME_INSTANCE_ID,
        updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      },
      {
        $set: {
          framework_state: runtimeInstanceDoc.framework_state,
          updatedBy: CUSTOMER_ADMIN_ID,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ])
  })

  test('records a system event when discovery input rollback fails after audit persistence failure', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedBy: CUSTOMER_ADMIN_ID,
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: {},
        sections: {},
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        framework_state: {
          ...runtimeInstanceDoc.framework_state,
          evidence_pack: {
            inputComplete: true,
            evidenceReady: true,
          },
        },
        updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      }))
      .mockResolvedValueOnce(null)
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    AuditLog.createLog = jest.fn()
      .mockRejectedValueOnce(new Error('audit unavailable'))
      .mockResolvedValueOnce({})
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('RUNTIME_STATE_MUTATION_AUDIT_FAILED')
    expect(res.body.error.details.rollbackFailed).toBe(true)
    expect(AuditLog.createLog).toHaveBeenCalledTimes(2)
    expect(AuditLog.createLog.mock.calls[1][0]).toEqual(expect.objectContaining({
      action: 'RUNTIME_STATE_MUTATED',
      isSystemEvent: true,
      systemEventType: 'RUNTIME_STATE_ROLLBACK_FAILED',
      eventSeverity: 'CRITICAL',
      diff: expect.objectContaining({
        runtimePath: 'framework_state.evidence_pack',
        reason: 'RUNTIME_MUTATION_AUDIT_PERSISTENCE_FAILED',
        auditError: expect.objectContaining({
          message: 'Runtime state mutation audit could not be persisted.',
        }),
      }),
    }))
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-acceptance persists accepted discovery truth with audit', async () => {
    const baseEvidencePack = makeReadyDiscoveryEvidencePack()
    const pendingCoverage = {
      status: 'SUFFICIENT_FOR_FRAMEWORK',
      requiredInputCount: 4,
      completedRequiredInputCount: 4,
      inputCount: 4,
      missingAreas: [],
      sourceCount: 1,
      evidenceObjectCount: 1,
      acceptedEvidenceCount: 0,
      pendingReviewCount: 1,
      rejectedEvidenceCount: 0,
      score: 100,
    }
    const evidencePack = {
      ...baseEvidencePack,
      acquisition: {
        profile: 'STANDARD',
        coverage: pendingCoverage,
      },
      evidence: {
        ...baseEvidencePack.evidence,
        coverage: pendingCoverage,
      },
    }
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: evidencePack,
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:02:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:01:00.000Z',
      })

    expect(res.status).toBe(200)
    const persistedEvidencePack = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.evidence_pack
    expect(persistedEvidencePack).toEqual(expect.objectContaining({
      inputComplete: true,
      evidenceReady: true,
      accepted: true,
      needsRefresh: false,
      acceptedAt: expect.any(String),
      acceptedBy: CUSTOMER_ADMIN_ID,
      acquisition: expect.objectContaining({
        coverage: expect.objectContaining({
          acceptedEvidenceCount: 1,
          pendingReviewCount: 0,
          rejectedEvidenceCount: 0,
        }),
      }),
      evidence: expect.objectContaining({
        coverage: expect.objectContaining({
          acceptedEvidenceCount: 1,
          pendingReviewCount: 0,
          rejectedEvidenceCount: 0,
        }),
      }),
      state: expect.objectContaining({
        status: 'ACCEPTED',
        accepted: true,
        needsRefresh: false,
      }),
    }))
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_STATE_MUTATED',
      resourceType: 'RuntimeInstance',
      resourceId: RUNTIME_INSTANCE_ID,
      diff: expect.objectContaining({
        runtimePath: 'framework_state.evidence_pack',
        operation: 'WRITE',
        previousValue: evidencePack,
        nextValue: expect.objectContaining({
          accepted: true,
          acceptedBy: CUSTOMER_ADMIN_ID,
        }),
      }),
    }))
    expect(res.body.data.discovery).toEqual(expect.objectContaining({
      inputComplete: true,
      evidenceReady: true,
      accepted: true,
      needsRefresh: false,
      acceptedAt: expect.any(String),
      acceptedBy: CUSTOMER_ADMIN_ID,
    }))
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-acceptance projects only accepted Evidence Objects into scoped GSIL views', async () => {
    const evidencePack = makeReviewableDiscoveryEvidencePack({
      evidenceObjects: [
        makeDiscoveryEvidenceObject({
          evidenceObjectId: 'evidence_rejected_competitor_fixture',
          sourceId: 'input_notes',
          category: 'Proof',
          coverageArea: 'Proof',
          extractedFact: 'Rejected competitor claim: unsupported market leadership.',
          reviewStatus: 'REJECTED',
          rejectedBy: CUSTOMER_ADMIN_ID,
          rejectionTimestamp: '2026-05-19T08:00:45.000Z',
          lineageRef: 'lineage:input_notes:rejected',
        }),
        makeDiscoveryEvidenceObject({
          evidenceObjectId: 'evidence_document_value_fixture',
          sourceId: 'document_customer_notes',
          category: 'Value Drivers',
          coverageArea: 'Decision Context',
          extractedFact: 'Document Customer Notes: governed workflow automation reduces manual proposal effort.',
          reviewStatus: 'PENDING',
          acquisitionMethod: 'DOCUMENT_INGESTION',
          lineageRef: 'lineage:document_customer_notes:value',
        }),
        makeDiscoveryEvidenceObject({
          evidenceObjectId: 'evidence_website_style_artifact_fixture',
          sourceId: 'website_style_artifact',
          category: 'Value Drivers',
          coverageArea: 'Decision Context',
          extractedFact: 'Website body: StylableButton2545352419__root{-archetype:box;cursor:pointer;box-sizing:border-box;width:100%;height:100%;display:block}',
          reviewStatus: 'PENDING',
          acquisitionMethod: 'WEBSITE_ACQUISITION',
          sourceUrl: 'https://acme.example/explore',
          lineageRef: 'lineage:website_style_artifact:value',
        }),
      ],
      scoped_views: {
        value_drivers: {
          source: 'DISCOVERY_EVIDENCE_PACK',
          summary: 'Pending scoped evidence must be rebuilt during acceptance.',
          sourceRefs: ['input_notes', 'document_customer_notes'],
        },
      },
      scopedViews: {
        value_drivers: {
          source: 'LEGACY_STALE_DISCOVERY_EVIDENCE_PACK',
          summary: 'Rejected competitor claim must not survive in legacy scopedViews.',
          sourceRefs: ['input_notes'],
        },
      },
    })
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: evidencePack,
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:02:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:01:00.000Z',
      })

    expect(res.status).toBe(200)
    const persistedEvidencePack = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.evidence_pack
    const scopedView = persistedEvidencePack.scoped_views.value_drivers
    expect(persistedEvidencePack.evidenceObjects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidenceObjectId: 'evidence_rejected_competitor_fixture',
        reviewStatus: 'REJECTED',
      }),
      expect.objectContaining({
        evidenceObjectId: 'evidence_document_value_fixture',
        reviewStatus: 'ACCEPTED',
        acceptedBy: CUSTOMER_ADMIN_ID,
      }),
    ]))
    expect(persistedEvidencePack.evidenceObjects).toEqual(expect.not.arrayContaining([
      expect.objectContaining({
        evidenceObjectId: 'evidence_website_style_artifact_fixture',
      }),
    ]))
    expect(scopedView).toEqual(expect.objectContaining({
      source: 'DISCOVERY_EVIDENCE_OBJECTS',
      reviewStatus: 'ACCEPTED_ONLY',
      evidenceKeys: ['evidenceObjects.accepted'],
      evidenceObjectIds: ['evidence_document_value_fixture'],
      sourceRefs: ['document_customer_notes'],
    }))
    expect(scopedView.summary).toContain('governed workflow automation')
    expect(scopedView.summary).not.toContain('unsupported market leadership')
    expect(persistedEvidencePack.scopedViews.value_drivers).toEqual(scopedView)
    expect(scopedView.evidenceFacts).toEqual([
      expect.objectContaining({
        evidenceObjectId: 'evidence_document_value_fixture',
        extractedFact: 'Document Customer Notes: governed workflow automation reduces manual proposal effort.',
      }),
    ])
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-evidence/:evidenceObjectId/review rejects invalid review status before mutation lookup', async () => {
    RuntimeInstance.findOne = jest.fn()
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-evidence/evidence_companyWebsite_fixture/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        reviewStatus: 'APPROVED',
        expectedUpdatedAt: '2026-05-19T08:01:00.000Z',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(RuntimeInstance.findOne).not.toHaveBeenCalled()
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-evidence/:evidenceObjectId/review rejects stale writes before persisting', async () => {
    const evidencePack = makeReviewableDiscoveryEvidencePack()
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: evidencePack,
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-evidence/evidence_companyWebsite_fixture/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        reviewStatus: 'REJECTED',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_STALE')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-evidence/:evidenceObjectId/review updates review state and evidence counts', async () => {
    const evidencePack = makeReviewableDiscoveryEvidencePack({
      sourceRegistry: [
        makeDiscoverySourceRegistryEntry({
          acceptedEvidenceObjects: 99,
          pendingEvidenceObjects: 99,
          rejectedEvidenceObjects: 99,
        }),
        makeDiscoverySourceRegistryEntry({
          sourceId: 'input_targetOffer',
          sourceType: 'DISCOVERY_NOTES',
          label: 'Target Product or Offer',
          lineageRef: 'lineage:input_targetOffer:fixture',
          fieldKey: 'targetOffer',
          url: undefined,
          acceptedEvidenceObjects: 99,
          pendingEvidenceObjects: 99,
          rejectedEvidenceObjects: 99,
        }),
      ],
    })
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: evidencePack,
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:02:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-evidence/evidence_companyWebsite_fixture/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        reviewStatus: 'REJECTED',
        expectedUpdatedAt: '2026-05-19T08:01:00.000Z',
      })

    expect(res.status).toBe(200)
    const persistedEvidencePack = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.evidence_pack
    expect(persistedEvidencePack).toEqual(expect.objectContaining({
      accepted: false,
      needsRefresh: false,
      evidence: expect.objectContaining({
        reviewSummary: {
          evidenceObjectCount: 2,
          acceptedEvidenceCount: 0,
          pendingReviewCount: 1,
          rejectedEvidenceCount: 1,
        },
      }),
      acquisition: expect.objectContaining({
        coverage: expect.objectContaining({
          sourceCount: 2,
          evidenceObjectCount: 2,
          acceptedEvidenceCount: 0,
          pendingReviewCount: 1,
          rejectedEvidenceCount: 1,
        }),
      }),
      state: expect.objectContaining({
        status: 'EVIDENCE_READY',
        accepted: false,
        needsRefresh: false,
        lastReviewedEvidenceObjectId: 'evidence_companyWebsite_fixture',
        lastReviewStatus: 'REJECTED',
      }),
    }))
    expect(persistedEvidencePack.evidenceObjects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidenceObjectId: 'evidence_companyWebsite_fixture',
        reviewStatus: 'REJECTED',
        rejectedBy: CUSTOMER_ADMIN_ID,
        rejectionTimestamp: expect.any(String),
        acceptedBy: '',
        acceptanceTimestamp: '',
      }),
      expect.objectContaining({
        evidenceObjectId: 'evidence_targetOffer_fixture',
        reviewStatus: 'PENDING',
      }),
    ]))
    expect(persistedEvidencePack.discoveryHealth).toEqual(expect.objectContaining({
      evidenceObjectCount: 2,
      acceptedEvidenceCount: 0,
      pendingReviewCount: 1,
      rejectedEvidenceCount: 1,
      sourceCount: 2,
    }))
    expect(persistedEvidencePack.sourceRegistry).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: 'input_companyWebsite',
        acceptedEvidenceObjects: 0,
        pendingEvidenceObjects: 0,
        rejectedEvidenceObjects: 1,
      }),
      expect.objectContaining({
        sourceId: 'input_targetOffer',
        acceptedEvidenceObjects: 0,
        pendingEvidenceObjects: 1,
        rejectedEvidenceObjects: 0,
      }),
    ]))
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_STATE_MUTATED',
      resourceType: 'RuntimeInstance',
      resourceId: RUNTIME_INSTANCE_ID,
      diff: expect.objectContaining({
        runtimePath: 'framework_state.evidence_pack',
        operation: 'WRITE',
        previousValue: evidencePack,
        nextValue: expect.objectContaining({
          accepted: false,
          evidenceObjects: expect.arrayContaining([
            expect.objectContaining({
              evidenceObjectId: 'evidence_companyWebsite_fixture',
              reviewStatus: 'REJECTED',
            }),
          ]),
        }),
      }),
    }))
    expect(res.body.data.discovery).toEqual(expect.objectContaining({
      accepted: false,
      evidenceObjectSummary: {
        evidenceObjectCount: 2,
        acceptedEvidenceCount: 0,
        pendingReviewCount: 1,
        rejectedEvidenceCount: 1,
      },
      sourceRegistrySummary: {
        count: 2,
        sourceTypes: ['WEBSITE', 'DISCOVERY_NOTES'],
      },
    }))
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-evidence/:evidenceObjectId/review rolls back when audit persistence fails', async () => {
    const evidencePack = makeReviewableDiscoveryEvidencePack()
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedBy: CUSTOMER_ADMIN_ID,
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: evidencePack,
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        framework_state: {
          ...runtimeInstanceDoc.framework_state,
          evidence_pack: {
            ...evidencePack,
            accepted: false,
            evidenceObjects: evidencePack.evidenceObjects.map((evidenceObject) =>
              evidenceObject.evidenceObjectId === 'evidence_companyWebsite_fixture'
                ? { ...evidenceObject, reviewStatus: 'REJECTED' }
                : evidenceObject),
          },
        },
        updatedAt: new Date('2026-05-19T08:02:00.000Z'),
      }))
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        updatedAt: new Date('2026-05-19T08:03:00.000Z'),
      }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    AuditLog.createLog = jest.fn(async () => {
      throw new Error('audit unavailable')
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-evidence/evidence_companyWebsite_fixture/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        reviewStatus: 'REJECTED',
        expectedUpdatedAt: '2026-05-19T08:01:00.000Z',
      })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('RUNTIME_STATE_MUTATION_AUDIT_FAILED')
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_AUDIT_PERSISTENCE_FAILED')
    expect(res.body.error.details.auditError).toEqual(expect.objectContaining({
      name: 'Error',
      message: 'audit unavailable',
    }))
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(RuntimeInstance.findOneAndUpdate.mock.calls[1]).toEqual([
      {
        _id: RUNTIME_INSTANCE_ID,
        updatedAt: new Date('2026-05-19T08:02:00.000Z'),
      },
      {
        $set: {
          framework_state: runtimeInstanceDoc.framework_state,
          updatedBy: CUSTOMER_ADMIN_ID,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ])
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-evidence/:evidenceObjectId/review rejects unknown evidence object without persisting', async () => {
    const evidencePack = makeReviewableDiscoveryEvidencePack()
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: evidencePack,
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-evidence/evidence_missing_fixture/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        reviewStatus: 'REJECTED',
        expectedUpdatedAt: '2026-05-19T08:01:00.000Z',
      })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('PATCH /api/v1/runtime-instances/:id/section-evidence stores section-scoped evidence without mutating the Intelligence Hub', async () => {
    const evidencePack = makeReviewableDiscoveryEvidencePack({ accepted: true })
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      packageId: FRAMEWORK_PACKAGE_ID,
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: evidencePack,
        sections: {
          value_drivers: {
            input: 'Initial value driver context.',
            state: { status: 'DRAFT' },
          },
        },
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:02:00.000Z'),
    }))
    FrameworkPackage.findById.mockResolvedValue(makeSectionEvidencePackage())
    const runtimePathRecords = makeSectionEvidenceRuntimePathRecords()
    RuntimePathRegistry.findOne = buildRuntimePathFindOneMock(runtimePathRecords)
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery(runtimePathRecords))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeSectionEvidenceUIContract()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-evidence`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.value_drivers',
        sectionKey: 'value_drivers',
        expectedUpdatedAt: '2026-05-19T08:01:00.000Z',
        documentSources: [
          {
            fileName: 'value-notes.md',
            mimeType: 'text/markdown',
            assetType: 'SECTION_SUPPORTING_FILE',
            sizeBytes: 156,
            textContent: 'Governed workflow automation reduces manual proposal effort for executive value narratives.',
          },
        ],
      })

    expect(res.status).toBe(200)
    const persistedFrameworkState = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state
    expect(persistedFrameworkState.evidence_pack).toEqual(evidencePack)
    const persistedSection = persistedFrameworkState.sections.value_drivers
    expect(persistedSection.additionalEvidence).toEqual(expect.objectContaining({
      status: 'PENDING_REVIEW',
      documentCount: 1,
      evidenceObjectCount: 1,
      acceptedEvidenceObjectCount: 0,
      pendingEvidenceObjectCount: 1,
      rejectedEvidenceObjectCount: 0,
    }))
    expect(persistedSection.additionalEvidence.documents[0]).toEqual(expect.objectContaining({
      fileName: 'value-notes.md',
      sourceId: expect.stringMatching(/^section_document_/),
      status: 'PROCESSED',
      ingestionMode: 'TEXT_NATIVE',
      evidenceObjectsGenerated: 1,
    }))
    expect(persistedSection.evidenceObjects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidenceObjectId: expect.stringMatching(/^section_evidence_/),
        sectionKey: 'value_drivers',
        runtimePath: 'framework_state.sections.value_drivers',
        sourceType: 'SECTION_UPLOADED_DOCUMENT',
        acquisitionMethod: 'SECTION_DOCUMENT_INGESTION',
        reviewStatus: 'PENDING',
        sourceFileName: 'value-notes.md',
        documentAssetType: 'SECTION_SUPPORTING_FILE',
      }),
    ]))
    expect(JSON.stringify(persistedSection)).not.toContain('textContent')
    expect(JSON.stringify(persistedSection)).not.toContain('contentBase64')
    expect(res.body.data.section.sectionEvidence).toEqual(expect.objectContaining({
      status: 'PENDING_REVIEW',
      documentCount: 1,
      evidenceObjectCount: 1,
      pendingEvidenceObjectCount: 1,
      evidenceObjects: [
        expect.objectContaining({
          sourceFileName: 'value-notes.md',
          snippet: 'Governed workflow automation reduces manual proposal effort for executive value narratives.',
        }),
      ],
    }))
    expect(JSON.stringify(res.body.data.section.sectionEvidence)).not.toContain('textContent')
    expect(JSON.stringify(res.body.data.section.sectionEvidence)).not.toContain('contentBase64')
    expect(JSON.stringify(AuditLog.createLog.mock.calls[0][0].diff)).not.toContain('textContent')
    expect(JSON.stringify(AuditLog.createLog.mock.calls[0][0].diff)).not.toContain('contentBase64')
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_STATE_MUTATED',
      resourceType: 'RuntimeInstance',
      resourceId: RUNTIME_INSTANCE_ID,
      diff: expect.objectContaining({
        runtimePath: 'framework_state.sections.value_drivers',
        reason: 'SECTION_EVIDENCE_UPLOAD',
        previousValue: expect.objectContaining({
          documentCount: 0,
          evidenceObjectCount: 0,
        }),
        nextValue: expect.objectContaining({
          documentCount: 1,
          evidenceObjectCount: 1,
        }),
      }),
    }))
  })

  test('PATCH /api/v1/runtime-instances/:id/section-evidence rejects unsupported files without partial persistence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      packageId: FRAMEWORK_PACKAGE_ID,
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReviewableDiscoveryEvidencePack({ accepted: true }),
        sections: {
          value_drivers: { input: 'Initial value driver context.' },
        },
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
    FrameworkPackage.findById.mockResolvedValue(makeSectionEvidencePackage())
    const runtimePathRecords = makeSectionEvidenceRuntimePathRecords()
    RuntimePathRegistry.findOne = buildRuntimePathFindOneMock(runtimePathRecords)
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery(runtimePathRecords))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeSectionEvidenceUIContract()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-evidence`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.value_drivers',
        sectionKey: 'value_drivers',
        expectedUpdatedAt: '2026-05-19T08:01:00.000Z',
        documentSources: [
          {
            fileName: 'value-notes.exe',
            mimeType: 'application/octet-stream',
            assetType: 'SECTION_SUPPORTING_FILE',
            sizeBytes: 32,
            textContent: 'Unsupported binary-like supporting evidence file.',
          },
        ],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('PATCH /api/v1/runtime-instances/:id/section-evidence rejects stale section upload without partial persistence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      packageId: FRAMEWORK_PACKAGE_ID,
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReviewableDiscoveryEvidencePack({ accepted: true }),
        sections: {
          value_drivers: { input: 'Initial value driver context.' },
        },
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
    FrameworkPackage.findById.mockResolvedValue(makeSectionEvidencePackage())
    const runtimePathRecords = makeSectionEvidenceRuntimePathRecords()
    RuntimePathRegistry.findOne = buildRuntimePathFindOneMock(runtimePathRecords)
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery(runtimePathRecords))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeSectionEvidenceUIContract()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-evidence`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.value_drivers',
        sectionKey: 'value_drivers',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        documentSources: [
          {
            fileName: 'value-notes.md',
            mimeType: 'text/markdown',
            assetType: 'SECTION_SUPPORTING_FILE',
            sizeBytes: 156,
            textContent: 'Governed workflow automation reduces manual proposal effort.',
          },
        ],
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.message).toBe('Runtime instance has changed since the renderer projection was loaded.')
    expect(res.body.error.details).toEqual(expect.objectContaining({
      expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      currentUpdatedAt: '2026-05-19T08:01:00.000Z',
    }))
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('PATCH /api/v1/runtime-instances/:id/section-evidence/:evidenceObjectId/review accepts evidence and invalidates stale section truth', async () => {
    const evidenceObject = makeSectionEvidenceObject()
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:03:00.000Z'),
      packageId: FRAMEWORK_PACKAGE_ID,
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReviewableDiscoveryEvidencePack({ accepted: true }),
        sections: {
          value_drivers: {
            input: 'Initial value driver context.',
            generated: {
              content: 'Value Drivers: faster proposal workflows.',
              generatedAt: '2026-05-19T08:01:00.000Z',
              inputHash: 'hash-input',
              sectionEvidenceHash: 'sha256:previous-section-evidence',
            },
            accepted: {
              content: 'Value Drivers: faster proposal workflows.',
              acceptedAt: '2026-05-19T08:02:00.000Z',
              acceptedBy: CUSTOMER_ADMIN_ID,
              sourceGeneratedAt: '2026-05-19T08:01:00.000Z',
              inputHash: 'hash-input',
            },
            review: { status: 'ACCEPTED' },
            state: { status: 'ACCEPTED' },
            additionalEvidence: makeSectionAdditionalEvidence({ evidenceObjects: [evidenceObject] }),
            evidenceObjects: [evidenceObject],
            gsilContext: {},
          },
        },
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:04:00.000Z'),
    }))
    FrameworkPackage.findById.mockResolvedValue(makeSectionEvidencePackage())
    const runtimePathRecords = makeSectionEvidenceRuntimePathRecords()
    RuntimePathRegistry.findOne = buildRuntimePathFindOneMock(runtimePathRecords)
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery(runtimePathRecords))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeSectionEvidenceUIContract()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-evidence/section_evidence_value_fixture/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.value_drivers',
        sectionKey: 'value_drivers',
        reviewStatus: 'ACCEPTED',
        expectedUpdatedAt: '2026-05-19T08:03:00.000Z',
      })

    expect(res.status).toBe(200)
    const persistedSection = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.sections.value_drivers
    expect(persistedSection.evidenceObjects[0]).toEqual(expect.objectContaining({
      evidenceObjectId: 'section_evidence_value_fixture',
      reviewStatus: 'ACCEPTED',
      acceptedBy: CUSTOMER_ADMIN_ID,
      acceptanceTimestamp: expect.any(String),
      rejectedBy: '',
      rejectionTimestamp: '',
    }))
    expect(persistedSection.gsilContext).toEqual(expect.objectContaining({
      sectionEvidenceSummary: expect.stringContaining('governed workflow automation reduces manual effort'),
      acceptedEvidenceObjectIds: ['section_evidence_value_fixture'],
      sourceRefs: ['section_evidence_value_fixture'],
    }))
    expect(persistedSection.state).toEqual(expect.objectContaining({
      needsRegeneration: true,
      sectionEvidenceInvalidatedAt: expect.any(String),
      sectionEvidenceInvalidatedBy: CUSTOMER_ADMIN_ID,
      acceptedInvalidatedAt: expect.any(String),
      acceptedInvalidationReason: 'SECTION_EVIDENCE_CHANGED',
    }))
    expect(persistedSection.intelligence.invalidation).toEqual(expect.objectContaining({
      reason: 'SECTION_EVIDENCE_CHANGED',
      invalidatedBy: CUSTOMER_ADMIN_ID,
      previousSectionEvidenceHash: expect.any(String),
      nextSectionEvidenceHash: expect.any(String),
    }))
    expect(res.body.data.section.sectionEvidence).toEqual(expect.objectContaining({
      status: 'ACCEPTED',
      acceptedEvidenceObjectCount: 1,
      pendingEvidenceObjectCount: 0,
      evidenceObjects: [
        expect.objectContaining({
          evidenceObjectId: 'section_evidence_value_fixture',
          reviewStatus: 'ACCEPTED',
          snippet: 'governed workflow automation reduces manual effort.',
        }),
      ],
    }))
    expect(JSON.stringify(res.body.data.section.sectionEvidence)).toContain('governed workflow automation reduces manual effort')
    expect(JSON.stringify(res.body.data.section.sectionEvidence)).not.toContain('textContent')
    expect(JSON.stringify(res.body.data.section.sectionEvidence)).not.toContain('contentBase64')
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      diff: expect.objectContaining({
        runtimePath: 'framework_state.sections.value_drivers',
        reason: 'SECTION_EVIDENCE_REVIEW',
        reviewStatus: 'ACCEPTED',
        acceptedEvidenceChanged: true,
      }),
    }))
  })

  test('PATCH /api/v1/runtime-instances/:id/section-evidence/:evidenceObjectId/review rejects stale review without partial persistence', async () => {
    const evidenceObject = makeSectionEvidenceObject()
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:03:00.000Z'),
      packageId: FRAMEWORK_PACKAGE_ID,
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReviewableDiscoveryEvidencePack({ accepted: true }),
        sections: {
          value_drivers: {
            input: 'Initial value driver context.',
            additionalEvidence: makeSectionAdditionalEvidence({ evidenceObjects: [evidenceObject] }),
            evidenceObjects: [evidenceObject],
          },
        },
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
    FrameworkPackage.findById.mockResolvedValue(makeSectionEvidencePackage())
    const runtimePathRecords = makeSectionEvidenceRuntimePathRecords()
    RuntimePathRegistry.findOne = buildRuntimePathFindOneMock(runtimePathRecords)
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery(runtimePathRecords))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeSectionEvidenceUIContract()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-evidence/section_evidence_value_fixture/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.value_drivers',
        sectionKey: 'value_drivers',
        reviewStatus: 'ACCEPTED',
        expectedUpdatedAt: '2026-05-19T08:02:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.message).toBe('Runtime instance has changed since the renderer projection was loaded.')
    expect(res.body.error.details).toEqual(expect.objectContaining({
      expectedUpdatedAt: '2026-05-19T08:02:00.000Z',
      currentUpdatedAt: '2026-05-19T08:03:00.000Z',
    }))
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('PATCH /api/v1/runtime-instances/:id/section-evidence/:evidenceObjectId/review rejects unknown section evidence object without partial persistence', async () => {
    const evidenceObject = makeSectionEvidenceObject()
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:03:00.000Z'),
      packageId: FRAMEWORK_PACKAGE_ID,
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReviewableDiscoveryEvidencePack({ accepted: true }),
        sections: {
          value_drivers: {
            input: 'Initial value driver context.',
            additionalEvidence: makeSectionAdditionalEvidence({ evidenceObjects: [evidenceObject] }),
            evidenceObjects: [evidenceObject],
          },
        },
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
    FrameworkPackage.findById.mockResolvedValue(makeSectionEvidencePackage())
    const runtimePathRecords = makeSectionEvidenceRuntimePathRecords()
    RuntimePathRegistry.findOne = buildRuntimePathFindOneMock(runtimePathRecords)
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery(runtimePathRecords))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeSectionEvidenceUIContract()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-evidence/section_evidence_missing/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.value_drivers',
        sectionKey: 'value_drivers',
        reviewStatus: 'ACCEPTED',
        expectedUpdatedAt: '2026-05-19T08:03:00.000Z',
      })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(res.body.error.message).toBe('Section evidence object was not found.')
    expect(res.body.error.details).toEqual(expect.objectContaining({
      evidenceObjectId: 'section_evidence_missing',
      runtimePath: 'framework_state.sections.value_drivers',
      sectionKey: 'value_drivers',
    }))
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('PATCH /api/v1/runtime-instances/:id/section-evidence/:evidenceObjectId/review rolls back when audit persistence fails', async () => {
    const evidenceObject = makeSectionEvidenceObject()
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedBy: CUSTOMER_ADMIN_ID,
      updatedAt: new Date('2026-05-19T08:03:00.000Z'),
      packageId: FRAMEWORK_PACKAGE_ID,
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReviewableDiscoveryEvidencePack({ accepted: true }),
        sections: {
          value_drivers: {
            input: 'Initial value driver context.',
            additionalEvidence: makeSectionAdditionalEvidence({ evidenceObjects: [evidenceObject] }),
            evidenceObjects: [evidenceObject],
          },
        },
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        framework_state: {
          ...runtimeInstanceDoc.framework_state,
          sections: {
            ...runtimeInstanceDoc.framework_state.sections,
            value_drivers: {
              ...runtimeInstanceDoc.framework_state.sections.value_drivers,
              evidenceObjects: [
                {
                  ...evidenceObject,
                  reviewStatus: 'ACCEPTED',
                },
              ],
            },
          },
        },
        updatedAt: new Date('2026-05-19T08:04:00.000Z'),
      }))
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        updatedAt: new Date('2026-05-19T08:05:00.000Z'),
      }))
    FrameworkPackage.findById.mockResolvedValue(makeSectionEvidencePackage())
    const runtimePathRecords = makeSectionEvidenceRuntimePathRecords()
    RuntimePathRegistry.findOne = buildRuntimePathFindOneMock(runtimePathRecords)
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery(runtimePathRecords))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeSectionEvidenceUIContract()))
    AuditLog.createLog = jest.fn(async () => {
      throw new Error('audit unavailable')
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-evidence/section_evidence_value_fixture/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.value_drivers',
        sectionKey: 'value_drivers',
        reviewStatus: 'ACCEPTED',
        expectedUpdatedAt: '2026-05-19T08:03:00.000Z',
      })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('RUNTIME_STATE_MUTATION_AUDIT_FAILED')
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(RuntimeInstance.findOneAndUpdate.mock.calls[1]).toEqual([
      {
        _id: RUNTIME_INSTANCE_ID,
        updatedAt: new Date('2026-05-19T08:04:00.000Z'),
      },
      {
        $set: {
          framework_state: runtimeInstanceDoc.framework_state,
          updatedBy: CUSTOMER_ADMIN_ID,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ])
  })

  test('GET /api/v1/runtime-instances/:id/evidence returns governed evidence details without fabricating sources', async () => {
    const pendingCoverage = {
      status: 'SUFFICIENT_FOR_FRAMEWORK',
      sourceCount: 1,
      evidenceObjectCount: 1,
      acceptedEvidenceCount: 0,
      pendingReviewCount: 1,
      rejectedEvidenceCount: 0,
      score: 100,
    }
    const baseEvidencePack = makeReadyDiscoveryEvidencePack({
      accepted: true,
      state: {
        status: 'ACCEPTED',
        inputComplete: true,
        evidenceReady: true,
        accepted: true,
        needsRefresh: false,
      },
    })
    const evidencePack = {
      ...baseEvidencePack,
      acquisition: {
        profile: 'STANDARD',
        coverage: pendingCoverage,
      },
      evidence: {
        ...baseEvidencePack.evidence,
        coverage: pendingCoverage,
      },
    }
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:02:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: evidencePack,
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/evidence`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.discovery).toEqual(expect.objectContaining({
      accepted: true,
      inputs: evidencePack.inputs,
      summaries: evidencePack.summaries,
      evidence: expect.objectContaining({
        ...evidencePack.evidence,
        coverage: expect.objectContaining({
          acceptedEvidenceCount: 1,
          pendingReviewCount: 0,
        }),
      }),
      acquisition: expect.objectContaining({
        coverage: expect.objectContaining({
          acceptedEvidenceCount: 1,
          pendingReviewCount: 0,
        }),
      }),
      scoped_views: evidencePack.scoped_views,
      lineage: evidencePack.lineage,
      revisions: [],
    }))
    expect(res.body.data.discovery.lineage.sources).toEqual([
      expect.objectContaining({
        sourceId: 'input_companyWebsite',
        type: 'USER_PROVIDED_WEBSITE',
        status: 'USER_PROVIDED',
      }),
    ])
    expect(JSON.stringify(res.body.data.discovery)).not.toMatch(/competitor|proof point/i)
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('GET /api/v1/runtime-instances/:id/evidence redacts raw evidence details for view-only users', async () => {
    const evidencePack = makeReadyDiscoveryEvidencePack({
      accepted: true,
      state: {
        status: 'ACCEPTED',
        inputComplete: true,
        evidenceReady: true,
        accepted: true,
        needsRefresh: false,
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:02:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: evidencePack,
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    }))
    const token = await getAccessTokenForUser(makeRegularUser())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/evidence`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.discovery).toEqual(expect.objectContaining({
      accepted: true,
      canViewRawEvidence: false,
      inputSummary: { keys: Object.keys(evidencePack.inputs), count: Object.keys(evidencePack.inputs).length },
      evidenceSummary: { keys: Object.keys(evidencePack.evidence), count: Object.keys(evidencePack.evidence).length },
      summarySummary: { keys: Object.keys(evidencePack.summaries), count: Object.keys(evidencePack.summaries).length },
      scopedViewSummary: { keys: Object.keys(evidencePack.scoped_views), count: Object.keys(evidencePack.scoped_views).length },
      lineageSummary: {
        sourceCount: evidencePack.lineage.sources.length,
        builderMode: 'DETERMINISTIC',
      },
      sourceRegistrySummary: {
        count: 1,
        sourceTypes: ['WEBSITE'],
      },
      evidenceObjectSummary: expect.objectContaining({
        evidenceObjectCount: 1,
      }),
    }))
    expect(res.body.data.discovery.inputs).toBeUndefined()
    expect(res.body.data.discovery.discovery).toBeUndefined()
    expect(res.body.data.discovery.summaries).toBeUndefined()
    expect(res.body.data.discovery.evidence).toBeUndefined()
    expect(res.body.data.discovery.sourceRegistry).toBeUndefined()
    expect(res.body.data.discovery.evidenceObjects).toBeUndefined()
    expect(res.body.data.discovery.discoveryHealth).toBeUndefined()
    expect(res.body.data.discovery.lineage).toBeUndefined()
    expect(res.body.data.discovery.scoped_views).toBeUndefined()
    expect(res.body.data.discovery.revisions).toBeUndefined()
    expect(res.body.data.discovery.acquisition.sourceRegistry).toBeUndefined()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test.each([
    ['missing evidence pack', {}, 'Intelligence Hub evidence must be refreshed before it can be accepted.'],
    ['incomplete evidence pack', {
      inputComplete: false,
      evidenceReady: false,
      accepted: false,
      needsRefresh: false,
      state: { status: 'INPUT_REQUIRED', inputComplete: false, evidenceReady: false },
    }, 'Intelligence Hub evidence is not ready for acceptance.'],
    ['stale evidence pack', {
      inputComplete: true,
      evidenceReady: true,
      accepted: false,
      needsRefresh: true,
      state: { status: 'NEEDS_REFRESH', inputComplete: true, evidenceReady: true, needsRefresh: true },
    }, 'Intelligence Hub evidence must be refreshed before acceptance.'],
    ['already accepted evidence pack', {
      inputComplete: true,
      evidenceReady: true,
      accepted: true,
      needsRefresh: false,
      state: { status: 'ACCEPTED', inputComplete: true, evidenceReady: true, accepted: true },
    }, 'Intelligence Hub evidence is already accepted.'],
    ['flag-only evidence pack', {
      inputComplete: true,
      evidenceReady: true,
      accepted: false,
      needsRefresh: false,
      state: { status: 'EVIDENCE_READY', inputComplete: true, evidenceReady: true },
    }, 'Intelligence Hub evidence is incomplete and must be refreshed before acceptance.'],
  ])('rejects discovery acceptance for %s', async (_caseName, evidencePack, message) => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: evidencePack,
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:01:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.message).toBe(message)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects stale discovery acceptance before state or audit persistence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:30:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack(),
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:01:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_STALE')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects discovery acceptance when the actor lacks mutation access', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack(),
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    const token = await getAccessTokenForUser(makeRegularUser())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:01:00.000Z',
      })

    expect(res.status).toBe(403)
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects discovery acceptance when the evidence pack path is not writable', async () => {
    const evidencePack = makeReadyDiscoveryEvidencePack()
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: evidencePack,
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord({
      allowedOperations: ['READ'],
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:01:00.000Z',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_INVALID_PATH')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rolls back discovery acceptance when audit persistence fails', async () => {
    const evidencePack = makeReadyDiscoveryEvidencePack()
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: evidencePack,
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        framework_state: {
          ...runtimeInstanceDoc.framework_state,
          evidence_pack: {
            ...evidencePack,
            accepted: true,
          },
        },
        updatedAt: new Date('2026-05-19T08:02:00.000Z'),
      }))
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        updatedAt: new Date('2026-05-19T08:03:00.000Z'),
      }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    AuditLog.createLog = jest.fn(async () => {
      throw new Error('audit unavailable')
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:01:00.000Z',
      })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('RUNTIME_STATE_MUTATION_AUDIT_FAILED')
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_AUDIT_PERSISTENCE_FAILED')
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(RuntimeInstance.findOneAndUpdate.mock.calls[1]).toEqual([
      {
        _id: RUNTIME_INSTANCE_ID,
        updatedAt: new Date('2026-05-19T08:02:00.000Z'),
      },
      {
        $set: {
          framework_state: runtimeInstanceDoc.framework_state,
          updatedBy: CUSTOMER_ADMIN_ID,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ])
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-reset clears discovery evidence and accepted section truth with audit', async () => {
    const evidencePack = makeReviewableDiscoveryEvidencePack({
      accepted: true,
      acceptedAt: '2026-05-19T08:02:00.000Z',
      acceptedBy: CUSTOMER_ADMIN_ID,
      state: {
        status: 'ACCEPTED',
        inputComplete: true,
        evidenceReady: true,
        accepted: true,
        needsRefresh: false,
      },
      scopedViews: {
        customer_problem: {
          source: 'LEGACY_STALE_DISCOVERY_EVIDENCE_PACK',
          summary: 'Legacy scoped view must be cleared.',
        },
      },
    })
    const generated = {
      format: 'TEXT',
      content: 'Customer Problem: Generated from previous Intelligence Hub evidence.',
      summary: 'Generated from previous evidence.',
      generatedAt: '2026-05-19T08:03:00.000Z',
      actionKey: 'GENERATE_SECTION',
      inputHash: 'hash-generated',
    }
    const accepted = {
      format: 'TEXT',
      content: 'Customer Problem: Accepted truth from previous Intelligence Hub evidence.',
      summary: 'Accepted from previous evidence.',
      truthHash: 'sha256:accepted-truth',
      acceptedAt: '2026-05-19T08:04:00.000Z',
      acceptedBy: CUSTOMER_ADMIN_ID,
      sourceActionKey: 'GENERATE_SECTION',
      sourceGeneratedAt: '2026-05-19T08:03:00.000Z',
      inputHash: 'hash-generated',
      sectionKey: 'customer_problem',
      runtimePath: 'framework_state.sections.customer_problem',
      revisions: [],
    }
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:05:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: evidencePack,
        sections: {
          customer_problem: {
            input: 'Keep the operator section input.',
            generated,
            accepted,
            review: {
              status: 'ACCEPTED',
            },
            state: {
              status: 'ACCEPTED',
              revisionCount: 0,
            },
            lineage: {
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
            },
            revisions: [],
          },
        },
        validation: {
          state: 'PASS',
        },
        readiness: {
          state: 'READY',
          ready: true,
          submittedForReview: true,
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:06:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-reset`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        confirmReset: true,
        expectedUpdatedAt: '2026-05-19T08:05:00.000Z',
        reason: 'USER_REQUESTED_DISCOVERY_RESET',
      })

    expect(res.status).toBe(200)
    const persistedFrameworkState = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state
    expect(persistedFrameworkState.evidence_pack).toEqual(expect.objectContaining({
      inputComplete: false,
      evidenceReady: false,
      accepted: false,
      needsRefresh: false,
      inputs: {},
      evidence: {},
      sourceRegistry: [],
      evidenceObjects: [],
      scoped_views: {},
      scopedViews: {},
      resetBy: CUSTOMER_ADMIN_ID,
      resetReason: 'USER_REQUESTED_DISCOVERY_RESET',
      resetSummary: expect.objectContaining({
        resetBy: CUSTOMER_ADMIN_ID,
        resetReason: 'USER_REQUESTED_DISCOVERY_RESET',
        previousEvidenceSummary: expect.objectContaining({
          accepted: true,
          evidenceObjectCount: 2,
          sourceRegistryCount: 2,
          scopedViewCount: 1,
        }),
        clearedSectionTruthCount: 1,
      }),
      state: expect.objectContaining({
        status: 'RESET',
        accepted: false,
        evidenceReady: false,
      }),
    }))
    expect(persistedFrameworkState.evidence_pack.lineage.sources).toEqual([])
    expect(persistedFrameworkState.evidence_pack.revisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reason: 'USER_REQUESTED_DISCOVERY_RESET',
        createdBy: CUSTOMER_ADMIN_ID,
      }),
    ]))
    expect(persistedFrameworkState.sections.customer_problem).toEqual(expect.objectContaining({
      input: 'Keep the operator section input.',
      generated: null,
      accepted: null,
      review: expect.objectContaining({
        status: 'PENDING_REVIEW',
        invalidationReason: 'DISCOVERY_RESET',
        invalidatedBy: CUSTOMER_ADMIN_ID,
      }),
      state: expect.objectContaining({
        status: 'DRAFT',
        revisionCount: 1,
        invalidationReason: 'DISCOVERY_RESET',
      }),
      dependencies: expect.objectContaining({
        state: 'DISCOVERY_CONTEXT_RESET',
        invalidatedByRuntimePath: 'framework_state.evidence_pack',
      }),
    }))
    expect(persistedFrameworkState.sections.customer_problem.revisions).toEqual([
      expect.objectContaining({
        revisionNumber: 1,
        reason: 'DISCOVERY_RESET',
        generated,
        accepted,
      }),
    ])
    expect(persistedFrameworkState.validation).toEqual({})
    expect(persistedFrameworkState.lifecycle).toEqual(expect.objectContaining({
      stage: 'DRAFT',
      invalidationReason: 'DISCOVERY_RESET',
      updatedBy: CUSTOMER_ADMIN_ID,
    }))
    expect(persistedFrameworkState.readiness).toEqual(expect.objectContaining({
      state: 'DRAFT',
      ready: false,
      submittedForReview: false,
      invalidatedByRuntimePath: 'framework_state.evidence_pack',
      sectionTruth: expect.objectContaining({
        state: 'DISCOVERY_RESET',
        publishEligible: false,
        lockEligible: false,
      }),
    }))
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_STATE_MUTATED',
      resourceType: 'RuntimeInstance',
      resourceId: RUNTIME_INSTANCE_ID,
      diff: expect.objectContaining({
        runtimePath: 'framework_state.evidence_pack',
        operation: 'WRITE',
        reason: 'DISCOVERY_RESET',
        resetReason: 'USER_REQUESTED_DISCOVERY_RESET',
        resetBy: CUSTOMER_ADMIN_ID,
        previousEvidenceSummary: expect.objectContaining({
          accepted: true,
          evidenceObjectCount: 2,
          sourceRegistryCount: 2,
          scopedViewCount: 1,
        }),
        nextEvidenceSummary: expect.objectContaining({
          accepted: false,
          evidenceObjectCount: 0,
          sourceRegistryCount: 0,
          scopedViewCount: 0,
        }),
        clearedSectionTruthCount: 1,
        clearedSectionTruths: [
          expect.objectContaining({
            sectionKey: 'customer_problem',
            hadGenerated: true,
            hadAccepted: true,
          }),
        ],
      }),
    }))
    expect(res.body.data.discovery).toEqual(expect.objectContaining({
      inputComplete: false,
      evidenceReady: false,
      accepted: false,
      needsRefresh: false,
      sourceRegistrySummary: {
        count: 0,
        sourceTypes: [],
      },
      evidenceObjectSummary: {
        evidenceObjectCount: 0,
        acceptedEvidenceCount: 0,
        pendingReviewCount: 0,
        rejectedEvidenceCount: 0,
      },
      resetSummary: expect.objectContaining({
        resetBy: CUSTOMER_ADMIN_ID,
        resetReason: 'USER_REQUESTED_DISCOVERY_RESET',
        previousEvidenceSummary: expect.objectContaining({
          evidenceObjectCount: 2,
          sourceRegistryCount: 2,
          scopedViewCount: 1,
        }),
        clearedSectionTruthCount: 1,
      }),
    }))
    expect(res.body.data.reset).toEqual(expect.objectContaining({
      resetBy: CUSTOMER_ADMIN_ID,
      resetReason: 'USER_REQUESTED_DISCOVERY_RESET',
      clearedSectionTruthCount: 1,
    }))
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-reset requires explicit confirmation before mutation lookup', async () => {
    RuntimeInstance.findOne = jest.fn()
    RuntimeInstance.findOneAndUpdate = jest.fn()
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-reset`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        confirmReset: false,
        expectedUpdatedAt: '2026-05-19T08:05:00.000Z',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(RuntimeInstance.findOne).not.toHaveBeenCalled()
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-reset validates cleared section runtime paths before persistence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:05:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReviewableDiscoveryEvidencePack({ accepted: true }),
        sections: {
          customer_problem: {
            generated: {
              content: 'Generated section intelligence.',
              generatedAt: '2026-05-19T08:03:00.000Z',
            },
            accepted: {
              content: 'Accepted section truth.',
              acceptedAt: '2026-05-19T08:04:00.000Z',
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
            },
            lineage: {
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
            },
            revisions: [],
          },
        },
        validation: {},
        readiness: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
    RuntimePathRegistry.findOne = buildRuntimePathFindOneMock([
      makeEvidencePackRuntimePathRecord(),
      makeRuntimePathRecord({ allowedOperations: ['READ'] }),
    ])
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-reset`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        confirmReset: true,
        expectedUpdatedAt: '2026-05-19T08:05:00.000Z',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_INVALID_PATH')
    expect(JSON.stringify(res.body.error.details.issues)).toContain('does not allow WRITE')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-reset rejects stale writes without audit', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:05:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack(),
        sections: {},
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-reset`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        confirmReset: true,
        expectedUpdatedAt: '2026-05-19T08:04:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_STALE')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-reset rolls back evidence, section truth, and readiness when audit persistence fails', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:05:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'READY' },
        evidence_pack: makeReviewableDiscoveryEvidencePack({ accepted: true }),
        sections: {
          customer_problem: {
            generated: {
              content: 'Generated section intelligence.',
              generatedAt: '2026-05-19T08:03:00.000Z',
            },
            accepted: {
              content: 'Accepted section truth.',
              acceptedAt: '2026-05-19T08:04:00.000Z',
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
            },
            state: {
              status: 'ACCEPTED',
            },
            lineage: {
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
            },
            revisions: [],
          },
        },
        validation: {
          state: 'PASS',
        },
        readiness: {
          state: 'READY',
          ready: true,
          submittedForReview: false,
        },
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        framework_state: {
          ...runtimeInstanceDoc.framework_state,
          evidence_pack: {
            inputComplete: false,
            evidenceReady: false,
          },
          sections: {
            customer_problem: {
              generated: null,
              accepted: null,
            },
          },
          readiness: {
            state: 'DRAFT',
            ready: false,
          },
        },
        updatedAt: new Date('2026-05-19T08:06:00.000Z'),
      }))
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        updatedAt: new Date('2026-05-19T08:07:00.000Z'),
      }))
    RuntimePathRegistry.findOne = buildRuntimePathFindOneMock([
      makeEvidencePackRuntimePathRecord(),
      makeRuntimePathRecord(),
    ])
    AuditLog.createLog = jest.fn(async () => {
      throw new Error('audit unavailable')
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-reset`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        confirmReset: true,
        expectedUpdatedAt: '2026-05-19T08:05:00.000Z',
      })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('RUNTIME_STATE_MUTATION_AUDIT_FAILED')
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_AUDIT_PERSISTENCE_FAILED')
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(RuntimeInstance.findOneAndUpdate.mock.calls[1]).toEqual([
      {
        _id: RUNTIME_INSTANCE_ID,
        updatedAt: new Date('2026-05-19T08:06:00.000Z'),
      },
      {
        $set: {
          framework_state: runtimeInstanceDoc.framework_state,
          updatedBy: CUSTOMER_ADMIN_ID,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ])
  })

  test('PATCH /api/v1/runtime-instances/:id/section-acceptance persists accepted section truth with audit', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
        }),
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: {
              format: 'TEXT',
              content: 'Customer Problem: Proposal creation is slow.',
              summary: 'Generated from current runtime input.',
              generatedAt: '2026-05-19T08:01:00.000Z',
              actionKey: 'GENERATE_SECTION',
              inputHash: 'hash-1',
            },
            accepted: null,
            review: {
              status: 'PENDING_REVIEW',
            },
            state: {
              status: 'GENERATED',
              revisionCount: 0,
            },
            lineage: {
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
            },
            revisions: [],
          },
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:02:00.000Z'),
    }))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        sectionKey: 'customer_problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(200)
    const persistedSection = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.sections.customer_problem
    expect(persistedSection.accepted).toEqual(expect.objectContaining({
      content: 'Customer Problem: Proposal creation is slow.',
      truthHash: expect.stringMatching(/^sha256:/),
      acceptedBy: CUSTOMER_ADMIN_ID,
      sourceActionKey: 'GENERATE_SECTION',
      sourceGeneratedAt: '2026-05-19T08:01:00.000Z',
      inputHash: 'hash-1',
      sectionKey: 'customer_problem',
      runtimePath: 'framework_state.sections.customer_problem',
      revisions: [],
    }))
    const acceptedTruthHash = persistedSection.accepted.truthHash
    expect(persistedSection.generated).toEqual(runtimeInstanceDoc.framework_state.sections.customer_problem.generated)
    expect(persistedSection.review).toEqual(expect.objectContaining({
      status: 'ACCEPTED',
      acceptedBy: CUSTOMER_ADMIN_ID,
      acceptedTruthHash,
    }))
    expect(persistedSection.state).toEqual(expect.objectContaining({
      status: 'ACCEPTED',
      acceptedBy: CUSTOMER_ADMIN_ID,
      acceptedSourceGeneratedAt: '2026-05-19T08:01:00.000Z',
      acceptedRevisionCount: 0,
      acceptedTruthHash,
    }))
    expect(persistedSection.lineage).toEqual(expect.objectContaining({
      acceptedTruthHash,
    }))
    expect(persistedSection.intelligence.acceptedTruth).toEqual(expect.objectContaining({
      state: 'CURRENT',
      truthHash: acceptedTruthHash,
      sourceActionKey: 'GENERATE_SECTION',
    }))
    expect(persistedSection.metrics).toEqual(expect.objectContaining({
      acceptedTruthRevisionCount: 0,
      acceptedTruthHash,
    }))
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_STATE_MUTATED',
      resourceType: 'RuntimeInstance',
      diff: expect.objectContaining({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        previousValue: null,
        nextValue: expect.objectContaining({
          content: 'Customer Problem: Proposal creation is slow.',
          sourceGeneratedAt: '2026-05-19T08:01:00.000Z',
        }),
      }),
    }))
    expect(res.body.data.section).toEqual(expect.objectContaining({
      sectionKey: 'customer_problem',
      runtimePath: 'framework_state.sections.customer_problem',
      accepted: expect.objectContaining({
        content: 'Customer Problem: Proposal creation is slow.',
        truthHash: acceptedTruthHash,
      }),
      previousAccepted: null,
    }))
  })

  test('rejects truth-ineligible section acceptance without state or audit persistence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
        }),
        sections: {
          value_drivers: {
            input: '',
            generated: {
              format: 'STRUCTURED_TEXT',
              content: 'Evidence not sufficient to derive this section safely.',
              summary: 'Insufficient evidence for section-safe generation.',
              generatedAt: '2026-05-19T08:01:00.000Z',
              actionKey: 'GENERATE_SECTION',
              inputHash: hashSectionInput(''),
              truthEligibility: {
                eligible: false,
                status: 'INSUFFICIENT_EVIDENCE',
                messages: [
                  {
                    code: 'INSUFFICIENT_EVIDENCE',
                    message: 'Evidence not sufficient to derive this section safely.',
                  },
                ],
              },
            },
            intelligence: {
              truthEligibility: {
                eligible: false,
                status: 'INSUFFICIENT_EVIDENCE',
                messages: [
                  {
                    code: 'INSUFFICIENT_EVIDENCE',
                    message: 'Evidence not sufficient to derive this section safely.',
                  },
                ],
              },
            },
            accepted: null,
            review: { status: 'PENDING_REVIEW' },
            state: {
              status: 'INSUFFICIENT_EVIDENCE',
              revisionCount: 0,
            },
            lineage: {
              sectionKey: 'value_drivers',
              runtimePath: 'framework_state.sections.value_drivers',
            },
            revisions: [],
          },
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
          validationKeys: ['required-sections-check'],
        },
      ],
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord({
      stableId: 'path-framework-state-sections-value-drivers',
      pathKey: 'framework_state.sections.value_drivers',
      label: 'Value Drivers',
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.value_drivers',
        sectionKey: 'value_drivers',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.message).toBe('Runtime section cannot be accepted until generated content is truth eligible.')
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('PATCH /api/v1/runtime-instances/:id/section-acceptance preserves previous accepted truth lineage', async () => {
    const previousAccepted = {
      format: 'TEXT',
      content: 'Customer Problem: Earlier accepted truth.',
      summary: 'Older accepted summary.',
      truthHash: 'sha256:previous-accepted-truth',
      acceptedAt: '2026-05-19T07:45:00.000Z',
      acceptedBy: CUSTOMER_ADMIN_ID,
      sourceActionKey: 'GENERATE_SECTION',
      sourceGeneratedAt: '2026-05-19T07:40:00.000Z',
      inputHash: 'hash-old',
      sectionKey: 'customer_problem',
      runtimePath: 'framework_state.sections.customer_problem',
      revisions: [],
    }
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
        }),
        sections: {
          customer_problem: {
            input: 'Proposal creation is still slow.',
            generated: {
              format: 'TEXT',
              content: 'Customer Problem: Proposal creation is still slow.',
              summary: 'Generated from updated runtime input.',
              generatedAt: '2026-05-19T08:01:00.000Z',
              actionKey: 'REGENERATE_SECTION',
              inputHash: 'hash-new',
            },
            accepted: previousAccepted,
            review: {
              status: 'PENDING_REVIEW',
            },
            state: {
              status: 'REGENERATED',
              revisionCount: 1,
              acceptedRevisionCount: 0,
            },
            lineage: {
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
            },
            revisions: [],
          },
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:02:00.000Z'),
    }))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        sectionKey: 'customer_problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(200)
    const persistedSection = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.sections.customer_problem
    expect(persistedSection.accepted).toEqual(expect.objectContaining({
      content: 'Customer Problem: Proposal creation is still slow.',
      truthHash: expect.stringMatching(/^sha256:/),
      sourceActionKey: 'REGENERATE_SECTION',
      sourceGeneratedAt: '2026-05-19T08:01:00.000Z',
      inputHash: 'hash-new',
      revisions: [
        expect.objectContaining({
          revisionNumber: 1,
          reason: 'ACCEPTED_TRUTH_REPLACED',
          accepted: expect.objectContaining({
            content: 'Customer Problem: Earlier accepted truth.',
            truthHash: 'sha256:previous-accepted-truth',
          }),
        }),
      ],
    }))
    expect(persistedSection.accepted.revisions[0].accepted.revisions).toBeUndefined()
    expect(persistedSection.state).toEqual(expect.objectContaining({
      acceptedRevisionCount: 1,
      acceptedTruthHash: persistedSection.accepted.truthHash,
    }))
    expect(persistedSection.metrics).toEqual(expect.objectContaining({
      acceptedTruthRevisionCount: 1,
      acceptedTruthHash: persistedSection.accepted.truthHash,
    }))
  })

  test('PATCH /api/v1/runtime-instances/:id/section-acceptance records downstream dependency invalidation', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
        }),
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: {
              format: 'TEXT',
              content: 'Customer Problem: Proposal creation is slow.',
              summary: 'Generated from current runtime input.',
              generatedAt: '2026-05-19T08:01:00.000Z',
              actionKey: 'GENERATE_SECTION',
              inputHash: 'hash-1',
            },
            accepted: null,
            review: { status: 'PENDING_REVIEW' },
            state: { status: 'GENERATED', revisionCount: 0 },
            lineage: {
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
            },
            revisions: [],
          },
          value_drivers: {
            input: 'Reduce proposal cycle time.',
            generated: {
              format: 'TEXT',
              content: 'Value Drivers: Reduce proposal cycle time.',
              generatedAt: '2026-05-19T07:40:00.000Z',
              actionKey: 'GENERATE_SECTION',
              inputHash: 'hash-value-drivers',
            },
            accepted: {
              content: 'Accepted value drivers truth.',
              acceptedAt: '2026-05-19T07:45:00.000Z',
              sourceGeneratedAt: '2026-05-19T07:40:00.000Z',
              inputHash: 'hash-value-drivers',
            },
            review: { status: 'ACCEPTED' },
            state: { status: 'ACCEPTED', revisionCount: 0 },
            lineage: {
              sectionKey: 'value_drivers',
              runtimePath: 'framework_state.sections.value_drivers',
            },
            revisions: [],
          },
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:02:00.000Z'),
    }))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
        },
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
          dependsOnSectionKeys: ['customer_problem'],
        },
      ],
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        sectionKey: 'customer_problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(200)
    const persistedSections = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.sections
    expect(persistedSections.value_drivers.dependencies).toEqual(expect.objectContaining({
      state: 'DEPENDENCY_CONTEXT_INVALIDATED',
      invalidatedBySectionKey: 'customer_problem',
      invalidatedByRuntimePath: 'framework_state.sections.customer_problem',
      invalidatedSectionKeys: ['customer_problem'],
      invalidations: [
        expect.objectContaining({
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          invalidatedBySectionKey: 'customer_problem',
          invalidatedByRuntimePath: 'framework_state.sections.customer_problem',
          reason: 'UPSTREAM_ACCEPTED_TRUTH_CHANGED',
        }),
      ],
    }))
    expect(persistedSections.value_drivers.state).toEqual(expect.objectContaining({
      dependencyStatus: 'DEPENDENCY_CONTEXT_INVALIDATED',
      needsRegeneration: true,
    }))
    expect(res.body.data.dependencyInvalidations).toEqual([
      expect.objectContaining({
        sectionKey: 'value_drivers',
        runtimePath: 'framework_state.sections.value_drivers',
        invalidatedBySectionKey: 'customer_problem',
      }),
    ])
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_STATE_MUTATED',
      diff: expect.objectContaining({
        runtimePath: 'framework_state.sections.customer_problem',
        dependencyInvalidations: [
          expect.objectContaining({
            sectionKey: 'value_drivers',
            runtimePath: 'framework_state.sections.value_drivers',
            invalidatedBySectionKey: 'customer_problem',
            invalidatedByRuntimePath: 'framework_state.sections.customer_problem',
            reason: 'UPSTREAM_ACCEPTED_TRUTH_CHANGED',
          }),
        ],
      }),
    }))
  })

  test('rejects section acceptance before generated content exists without state or audit persistence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
        }),
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: null,
            review: {},
            state: { status: 'DRAFT' },
            lineage: {},
            revisions: [],
          },
        },
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects section acceptance when accepted section evidence requires regeneration', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
        }),
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: {
              content: 'Customer Problem: Proposal creation is slow.',
              generatedAt: '2026-05-19T08:01:00.000Z',
              actionKey: 'GENERATE_SECTION',
              inputHash: 'hash-1',
            },
            review: {
              status: 'PENDING_REVIEW',
              invalidatedAt: '2026-05-19T08:02:00.000Z',
              invalidationReason: 'SECTION_EVIDENCE_CHANGED',
            },
            state: {
              status: 'GENERATED',
              needsRegeneration: true,
              sectionEvidenceInvalidatedAt: '2026-05-19T08:02:00.000Z',
              acceptedInvalidationReason: 'SECTION_EVIDENCE_CHANGED',
            },
            lineage: {
              sectionEvidenceInvalidationReason: 'SECTION_EVIDENCE_CHANGED',
            },
            intelligence: {
              invalidation: {
                reason: 'SECTION_EVIDENCE_CHANGED',
              },
            },
            revisions: [],
          },
        },
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.message).toBe('Accepted section evidence changed. Regenerate this section before accepting truth.')
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects already-current section acceptance without state or audit persistence', async () => {
    const generated = {
      content: 'Customer Problem: Proposal creation is slow.',
      generatedAt: '2026-05-19T08:01:00.000Z',
      actionKey: 'GENERATE_SECTION',
      inputHash: 'hash-1',
    }
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
        }),
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated,
            accepted: {
              content: generated.content,
              sourceGeneratedAt: generated.generatedAt,
              inputHash: generated.inputHash,
            },
            review: { status: 'ACCEPTED' },
            state: { status: 'ACCEPTED' },
            lineage: {},
            revisions: [],
          },
        },
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        sectionKey: 'customer_problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.message).toBe('Runtime section generated content is already accepted.')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects legacy already-accepted section content without source metadata', async () => {
    const generated = {
      content: 'Customer Problem: Proposal creation is slow.',
      actionKey: 'GENERATE_SECTION',
    }
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
          scoped_views: {
            value_drivers: {
              source: 'DISCOVERY_EVIDENCE_PACK',
              summary: 'Accepted Intelligence Hub evidence supports value themes for proposal workflow improvement.',
              sourceRefs: ['input_targetOffer'],
            },
          },
        }),
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated,
            accepted: {
              content: generated.content,
              acceptedAt: '2026-05-19T08:02:00.000Z',
              acceptedBy: CUSTOMER_ADMIN_ID,
            },
            review: { status: 'ACCEPTED' },
            state: { status: 'ACCEPTED' },
            lineage: {},
            revisions: [],
          },
        },
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        sectionKey: 'customer_problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.message).toBe('Runtime section generated content is already accepted.')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects stale section acceptance and target mismatches before persistence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
        }),
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: {
              content: 'Customer Problem: Proposal creation is slow.',
              generatedAt: '2026-05-19T08:01:00.000Z',
              inputHash: 'hash-1',
            },
          },
        },
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
        },
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
        },
      ],
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const staleRes = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        sectionKey: 'customer_problem',
        expectedUpdatedAt: '2026-05-19T07:59:00.000Z',
      })

    expect(staleRes.status).toBe(409)
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()

    const mismatchRes = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        sectionKey: 'customer_problem',
        runtimePath: 'framework_state.sections.value_drivers',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(mismatchRes.status).toBe(422)
    expect(mismatchRes.body.error.details.reason).toBe('RUNTIME_ACTION_TARGET_MISMATCH')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rolls back section acceptance when audit persistence fails', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
        }),
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: {
              format: 'TEXT',
              content: 'Customer Problem: Proposal creation is slow.',
              generatedAt: '2026-05-19T08:01:00.000Z',
              actionKey: 'GENERATE_SECTION',
              inputHash: 'hash-1',
            },
            accepted: null,
            review: { status: 'PENDING_REVIEW' },
            state: { status: 'GENERATED', revisionCount: 0 },
            lineage: {
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
            },
            revisions: [],
          },
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        framework_state: {
          ...runtimeInstanceDoc.framework_state,
          sections: {
            customer_problem: {
              ...runtimeInstanceDoc.framework_state.sections.customer_problem,
              accepted: {
                content: 'Customer Problem: Proposal creation is slow.',
              },
            },
          },
        },
        updatedAt: new Date('2026-05-19T08:02:00.000Z'),
      }))
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        updatedAt: new Date('2026-05-19T08:03:00.000Z'),
      }))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    AuditLog.createLog = jest.fn(async () => {
      throw new Error('audit unavailable')
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        sectionKey: 'customer_problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('RUNTIME_STATE_MUTATION_AUDIT_FAILED')
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_AUDIT_PERSISTENCE_FAILED')
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(RuntimeInstance.findOneAndUpdate.mock.calls[1]).toEqual([
      {
        _id: RUNTIME_INSTANCE_ID,
        updatedAt: new Date('2026-05-19T08:02:00.000Z'),
      },
      {
        $set: {
          framework_state: runtimeInstanceDoc.framework_state,
          updatedBy: CUSTOMER_ADMIN_ID,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ])
  })

  test('PATCH /api/v1/runtime-instances/:id/data archives generated and accepted truth when section input changes', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
          scoped_views: {
            value_drivers: {
              source: 'DISCOVERY_EVIDENCE_PACK',
              summary: 'Accepted Intelligence Hub evidence supports value themes for proposal workflow improvement.',
              sourceRefs: ['input_targetOffer'],
            },
          },
        }),
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: {
              content: 'Customer Problem: Proposal creation is slow.',
              generatedAt: '2026-05-19T08:01:00.000Z',
              inputHash: hashSectionInput('Proposal creation is slow.'),
            },
            accepted: {
              content: 'Accepted customer problem truth.',
              acceptedAt: '2026-05-19T08:02:00.000Z',
              sourceGeneratedAt: '2026-05-19T08:01:00.000Z',
              inputHash: hashSectionInput('Proposal creation is slow.'),
            },
            review: {
              status: 'ACCEPTED',
            },
            state: {
              status: 'ACCEPTED',
              revisionCount: 1,
            },
            lineage: {
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
              actionKey: 'GENERATE_SECTION',
            },
            revisions: [
              {
                revisionNumber: 1,
                generated: {
                  content: 'Customer Problem: Older generated content.',
                },
                replacedAt: '2026-05-19T08:01:00.000Z',
              },
            ],
          },
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Proposal teams lack a shared story.',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(200)
    const persistedSection = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.sections.customer_problem
    expect(persistedSection).toEqual(expect.objectContaining({
      input: 'Proposal teams lack a shared story.',
      generated: null,
      accepted: null,
      review: expect.objectContaining({
        status: 'PENDING_REVIEW',
        invalidationReason: 'SECTION_INPUT_CHANGED',
      }),
      state: expect.objectContaining({
        status: 'DRAFT',
        revisionCount: 2,
        invalidationReason: 'SECTION_INPUT_CHANGED',
      }),
      lineage: expect.objectContaining({
        sectionKey: 'customer_problem',
        runtimePath: 'framework_state.sections.customer_problem',
        invalidationReason: 'SECTION_INPUT_CHANGED',
      }),
      revisions: [
        expect.objectContaining({
          revisionNumber: 1,
        }),
        expect.objectContaining({
          revisionNumber: 2,
          reason: 'SECTION_INPUT_CHANGED',
          generated: expect.objectContaining({
            content: 'Customer Problem: Proposal creation is slow.',
          }),
          accepted: expect.objectContaining({
            content: 'Accepted customer problem truth.',
          }),
        }),
      ],
    }))
    expect(res.body.data.mutation).toEqual(expect.objectContaining({
      previousValue: 'Proposal creation is slow.',
      value: 'Proposal teams lack a shared story.',
    }))
  })

  test('PATCH /api/v1/runtime-instances/:id/data archives legacy section-key truth when writing a runtime-path state key', async () => {
    const runtimePath = 'framework_state.sections.section_4_value_drivers'
    const previousInput = {
      summary: 'Value drivers focus on reducing manual proposal cycles.',
    }
    const nextInput = {
      summary: 'Value drivers focus on reusable governed value narratives.',
    }
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
        }),
        sections: {
          'section-value-drivers': {
            input: previousInput,
            generated: {
              content: 'Value Drivers: reduce manual proposal cycles.',
              generatedAt: '2026-05-19T08:01:00.000Z',
              inputHash: hashSectionInput(previousInput),
            },
            accepted: {
              content: 'Accepted value drivers truth.',
              acceptedAt: '2026-05-19T08:02:00.000Z',
              sourceGeneratedAt: '2026-05-19T08:01:00.000Z',
              inputHash: hashSectionInput(previousInput),
            },
            review: {
              status: 'ACCEPTED',
            },
            state: {
              status: 'ACCEPTED',
              revisionCount: 0,
            },
            lineage: {
              sectionKey: 'section-value-drivers',
              runtimePath,
              actionKey: 'GENERATE_SECTION',
            },
            revisions: [],
          },
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord({
      stableId: 'path-framework-state-sections-section-4-value-drivers',
      pathKey: runtimePath,
      label: 'Value Drivers',
      dataType: 'OBJECT',
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath,
        operation: 'WRITE',
        value: nextInput,
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(200)
    const persistedSections = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.sections
    expect(persistedSections['section-value-drivers']).toBeUndefined()
    expect(persistedSections.section_4_value_drivers).toEqual(expect.objectContaining({
      input: nextInput,
      generated: null,
      accepted: null,
      state: expect.objectContaining({
        status: 'DRAFT',
        revisionCount: 1,
        invalidationReason: 'SECTION_INPUT_CHANGED',
      }),
      revisions: [
        expect.objectContaining({
          revisionNumber: 1,
          reason: 'SECTION_INPUT_CHANGED',
          generated: expect.objectContaining({
            content: 'Value Drivers: reduce manual proposal cycles.',
          }),
          accepted: expect.objectContaining({
            content: 'Accepted value drivers truth.',
          }),
        }),
      ],
    }))
    expect(res.body.data.mutation).toEqual(expect.objectContaining({
      previousValue: previousInput,
      value: nextInput,
    }))
  })

  test('rejects runtime state mutation outside framework_state.sections scope', async () => {
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.lifecycle.stage',
        operation: 'WRITE',
        value: 'READY',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_FORBIDDEN_PATH')
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects runtime state mutation when the registered path lacks WRITE', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord({
      allowedOperations: ['READ'],
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Updated problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_INVALID_PATH')
    expect(res.body.error.details.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringContaining('does not allow WRITE'),
      }),
    ]))
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects runtime state mutation when the registered path is protected', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord({
      isProtected: true,
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Updated problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_INVALID_PATH')
    expect(res.body.error.details.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringContaining('protected from runtime writes'),
      }),
    ]))
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects stale runtime state mutation before writing state or audit', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:30:00.000Z'),
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Updated problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_STALE')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects runtime state mutation when the atomic updatedAt guard loses a write race', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn().mockResolvedValue(null)
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Updated problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_STALE')
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: RUNTIME_INSTANCE_ID,
        updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          framework_state: expect.any(Object),
        }),
      }),
      {
        new: true,
        runValidators: true,
      },
    )
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects runtime state mutation when the actor lacks VMF_UPDATE access', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    const token = await getAccessTokenForUser(makeRegularUser())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Updated problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(403)
    expect(res.body.error.details.reason).toBe('FORBIDDEN')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects runtime state mutation for non-Value Narrative runtime types in Sprint 1', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      runtimeType: 'DEAL_ANALYSIS',
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Updated problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_UNSUPPORTED_RUNTIME_TYPE')
    expect(res.body.error.details.supportedRuntimeTypes).toEqual(['VALUE_NARRATIVE'])
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rolls back a non-transactional runtime state mutation when audit persistence fails', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Original problem.',
        },
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        framework_state: {
          ...runtimeInstanceDoc.framework_state,
          sections: {
            customer_problem: 'Updated problem.',
          },
        },
        updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      }))
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        updatedAt: new Date('2026-05-19T08:02:00.000Z'),
      }))
    AuditLog.createLog = jest.fn(async () => {
      throw new Error('audit unavailable')
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Updated problem.',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('RUNTIME_STATE_MUTATION_AUDIT_FAILED')
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_AUDIT_PERSISTENCE_FAILED')
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(RuntimeInstance.findOneAndUpdate.mock.calls[1]).toEqual([
      {
        _id: RUNTIME_INSTANCE_ID,
        updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      },
      {
        $set: {
          framework_state: runtimeInstanceDoc.framework_state,
          updatedBy: CUSTOMER_ADMIN_ID,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ])
  })

  test('POST /api/v1/runtime-instances/:id/actions/RUN_VALIDATION persists governed validation and audit evidence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'READY',
          ready: true,
          validationState: 'PASSED',
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('RUN_VALIDATION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('RUN_VALIDATION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('RUN_VALIDATION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: RUNTIME_INSTANCE_ID,
        updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      },
      {
        $set: expect.objectContaining({
          executionStatus: 'IDLE',
          framework_state: expect.objectContaining({
            validation: expect.objectContaining({
              runtime_required_sections: expect.objectContaining({
                is_valid: true,
                status: 'PASSED',
              }),
            }),
            readiness: expect.objectContaining({
              state: 'VALIDATED',
              validationState: 'PASSED',
              lastActionKey: 'RUN_VALIDATION',
            }),
          }),
          updatedBy: CUSTOMER_ADMIN_ID,
        }),
      },
      {
        new: true,
        runValidators: true,
      },
    )
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_ACTION_EXECUTED',
      resourceType: 'RuntimeInstance',
      resourceId: RUNTIME_INSTANCE_ID,
      scope: expect.objectContaining({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        runtimeInstanceId: RUNTIME_INSTANCE_ID,
        runtimeInstanceKey: 'value-narrative-439111',
      }),
      diff: expect.objectContaining({
        actionKey: 'RUN_VALIDATION',
        governedAction: 'RUN_VALIDATION',
        executionStatus: {
          from: 'IDLE',
          to: 'IDLE',
        },
        validation: expect.objectContaining({
          key: 'runtime_required_sections',
          status: 'PASSED',
          is_valid: true,
        }),
      }),
    }))
    expect(res.body.data.state.readiness).toEqual(expect.objectContaining({
      state: 'VALIDATED',
      validationState: 'PASSED',
    }))
  })

  test('POST /api/v1/runtime-instances/:id/actions/BUILD_EVIDENCE_PACK persists governed evidence with action audit', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: {},
        sections: {},
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('BUILD_EVIDENCE_PACK')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeEvidencePackRuntimePathRecord(),
    ]))
    RuntimePathRegistry.findOne.mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('BUILD_EVIDENCE_PACK')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('BUILD_EVIDENCE_PACK')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/BUILD_EVIDENCE_PACK`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        acquisitionProfile: 'STANDARD',
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
      })

    expect(res.status).toBe(200)
    expect(res.body.data.action).toEqual(expect.objectContaining({
      actionKey: 'BUILD_EVIDENCE_PACK',
      governedAction: 'BUILD_EVIDENCE_PACK',
    }))
    expect(res.body.data.state.discovery).toEqual(expect.objectContaining({
      status: 'EVIDENCE_READY',
      inputComplete: true,
      evidenceReady: true,
      accepted: false,
      acquisitionProfile: 'STANDARD',
      inputCount: 4,
      sourceCount: 4,
    }))
    const persistedEvidencePack = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.evidence_pack
    expect(persistedEvidencePack).toEqual(expect.objectContaining({
      inputComplete: true,
      evidenceReady: true,
      accepted: false,
      acquisitionProfile: 'STANDARD',
      acquisition: expect.objectContaining({
        profile: 'STANDARD',
        coverage: expect.objectContaining({
          score: 100,
          pendingReviewCount: 4,
        }),
      }),
      summaries: expect.objectContaining({
        compact: expect.objectContaining({
          confidence: 'USER_PROVIDED',
        }),
      }),
      scoped_views: expect.objectContaining({
        customer_problem: expect.objectContaining({
          source: 'DISCOVERY_EVIDENCE_PACK',
        }),
      }),
      lineage: expect.objectContaining({
        sources: expect.arrayContaining([
          expect.objectContaining({
            sourceId: 'input_companyWebsite',
            type: 'USER_PROVIDED_WEBSITE',
            status: 'USER_PROVIDED',
            acquisitionProfile: 'STANDARD',
          }),
        ]),
        builder: expect.objectContaining({
          acquisitionProfile: 'STANDARD',
        }),
      }),
    }))
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_ACTION_EXECUTED',
      diff: expect.objectContaining({
        actionKey: 'BUILD_EVIDENCE_PACK',
        discovery: expect.objectContaining({
          status: 'EVIDENCE_READY',
          acquisitionProfile: 'STANDARD',
          inputCount: 4,
          sourceCount: 4,
        }),
      }),
    }))
  })

  test('POST /api/v1/runtime-instances/:id/actions/BUILD_EVIDENCE_PACK executes Enhanced website acquisition', async () => {
    mockEnhancedWebsiteFetch()
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: {},
        sections: {},
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('BUILD_EVIDENCE_PACK')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeEvidencePackRuntimePathRecord(),
    ]))
    RuntimePathRegistry.findOne.mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('BUILD_EVIDENCE_PACK')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('BUILD_EVIDENCE_PACK')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/BUILD_EVIDENCE_PACK`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        acquisitionProfile: 'ENHANCED',
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
      })

    expect(res.status).toBe(200)
    expect(res.body.data.state.discovery).toEqual(expect.objectContaining({
      status: 'EVIDENCE_READY',
      inputComplete: true,
      evidenceReady: true,
      accepted: false,
      acquisitionProfile: 'ENHANCED',
      inputCount: 4,
      sourceCount: expect.any(Number),
    }))
    expect(res.body.data.state.discovery.sourceCount).toBeGreaterThan(4)
    const persistedEvidencePack = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.evidence_pack
    expect(persistedEvidencePack.acquisition).toEqual(expect.objectContaining({
      profile: 'ENHANCED',
      websiteAcquisition: expect.objectContaining({
        status: 'ACQUIRED',
      }),
      confidence: expect.objectContaining({
        level: 'SOURCE_BACKED',
      }),
    }))
    expect(persistedEvidencePack.evidenceObjects.some((evidenceObject) =>
      evidenceObject.acquisitionMethod === 'WEBSITE_ACQUISITION')).toBe(true)
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_ACTION_EXECUTED',
      diff: expect.objectContaining({
        actionKey: 'BUILD_EVIDENCE_PACK',
        discovery: expect.objectContaining({
          status: 'EVIDENCE_READY',
          acquisitionProfile: 'ENHANCED',
          sourceCount: persistedEvidencePack.sourceRegistry.length,
        }),
      }),
    }))
  })

  test.each(['STRATEGIC'])(
    'POST /api/v1/runtime-instances/:id/actions/BUILD_EVIDENCE_PACK rejects reserved %s Acquisition',
    async (acquisitionProfile) => {
      RuntimeInstance.findOne = jest.fn()
      const token = await getAccessTokenForUser(makeCustomerAdmin())

      const res = await request
        .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/BUILD_EVIDENCE_PACK`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
          acquisitionProfile,
          inputs: {
            companyWebsite: 'https://acme.example',
            companyName: 'Acme',
            marketRegion: 'UK enterprise',
            targetOffer: 'Managed proposal platform',
          },
        })

      expect(res.status).toBe(422)
      expect(res.body.error).toEqual(expect.objectContaining({
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed.',
      }))
      expect(res.body.error.details.acquisitionProfile).toBe(
        'acquisitionProfile must be STANDARD or ENHANCED. STRATEGIC is not available in this sprint.',
      )
      expect(RuntimeInstance.findOne).not.toHaveBeenCalled()
    },
  )

  test('POST /api/v1/runtime-instances/:id/actions/RUN_VALIDATION rejects acquisitionProfile on non-discovery actions', async () => {
    RuntimeInstance.findOne = jest.fn()
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        acquisitionProfile: 'STANDARD',
      })

    expect(res.status).toBe(422)
    expect(res.body.error).toEqual(expect.objectContaining({
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed.',
    }))
    expect(res.body.error.details._root).toBe(
      'acquisitionProfile is only allowed for Intelligence Hub evidence build actions.',
    )
    expect(RuntimeInstance.findOne).not.toHaveBeenCalled()
  })

  test('POST /api/v1/runtime-instances/:id/actions/GENERATE_SECTION rejects documentSources on non-discovery actions', async () => {
    RuntimeInstance.findOne = jest.fn()
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/GENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        runtimePath: 'framework_state.sections.customer_problem',
        documentSources: [
          {
            fileName: 'customer-notes.txt',
            mimeType: 'text/plain',
            sizeBytes: 20,
            textContent: 'Intelligence Hub note content.',
          },
        ],
      })

    expect(res.status).toBe(422)
    expect(res.body.error).toEqual(expect.objectContaining({
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed.',
    }))
    expect(res.body.error.details._root).toBe(
      'documentSources are only allowed for Intelligence Hub evidence build actions.',
    )
    expect(RuntimeInstance.findOne).not.toHaveBeenCalled()
  })

  test.each([
    ['SAVE_DISCOVERY_INPUTS', {}, {
      companyWebsite: 'https://acme.example',
      companyName: 'Acme',
      marketRegion: 'UK enterprise',
      targetOffer: 'Managed proposal platform',
    }],
    ['REFRESH_EVIDENCE_PACK', makeReadyDiscoveryEvidencePack({
      inputs: {
        companyWebsite: 'https://refresh.example',
        companyName: 'Refresh Co',
        marketRegion: 'UK mid-market',
        targetOffer: 'Discovery refresh service',
      },
    }), null],
  ])('POST /api/v1/runtime-instances/:id/actions/%s persists governed discovery evidence with action audit', async (actionKey, previousEvidencePack, payloadInputs) => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: previousEvidencePack,
        sections: {},
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding(actionKey)],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeEvidencePackRuntimePathRecord(),
    ]))
    RuntimePathRegistry.findOne.mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction(actionKey)],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy(actionKey)]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/${actionKey}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        ...(payloadInputs ? { inputs: payloadInputs } : {}),
      })

    expect(res.status).toBe(200)
    expect(res.body.data.action).toEqual(expect.objectContaining({
      actionKey,
      governedAction: actionKey,
    }))
    expect(res.body.data.state.discovery).toEqual(expect.objectContaining({
      status: 'EVIDENCE_READY',
      inputComplete: true,
      evidenceReady: true,
      accepted: false,
      inputCount: 4,
      sourceCount: 4,
    }))
    const persistedEvidencePack = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.evidence_pack
    expect(persistedEvidencePack.revisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: actionKey }),
    ]))
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_ACTION_EXECUTED',
      diff: expect.objectContaining({
        actionKey,
        discovery: expect.objectContaining({
          status: 'EVIDENCE_READY',
          inputCount: 4,
          sourceCount: 4,
        }),
      }),
    }))
  })

  test('POST /api/v1/runtime-instances/:id/actions/BUILD_EVIDENCE_PACK ingests uploaded document evidence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: {},
        sections: {},
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('BUILD_EVIDENCE_PACK')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeEvidencePackRuntimePathRecord(),
    ]))
    RuntimePathRegistry.findOne.mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('BUILD_EVIDENCE_PACK')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('BUILD_EVIDENCE_PACK')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/BUILD_EVIDENCE_PACK`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
        documentSources: [
          {
            fileName: 'proposal-notes.txt',
            mimeType: 'text/plain',
            sizeBytes: 92,
            textContent: 'Proposal teams need governed automation and reusable value narrative outputs.',
          },
        ],
      })

    expect(res.status).toBe(200)
    const persistedEvidencePack = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.evidence_pack
    expect(persistedEvidencePack.evidence.source).toBe('DISCOVERY_INPUTS_AND_DOCUMENT_INGESTION')
    expect(persistedEvidencePack.evidenceObjects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        acquisitionMethod: 'DOCUMENT_INGESTION',
        extractedFact: expect.stringContaining('governed automation'),
      }),
    ]))
    expect(res.body.data.state.discovery).toEqual(expect.objectContaining({
      status: 'EVIDENCE_READY',
      inputComplete: true,
      evidenceReady: true,
      sourceCount: 5,
    }))
  })

  test('POST /api/v1/runtime-instances/:id/actions/ACCEPT_EVIDENCE accepts governed evidence with action audit', async () => {
    const evidencePack = makeReviewableDiscoveryEvidencePack()
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: evidencePack,
        sections: {},
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('ACCEPT_EVIDENCE')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeEvidencePackRuntimePathRecord(),
    ]))
    RuntimePathRegistry.findOne.mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('ACCEPT_EVIDENCE')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('ACCEPT_EVIDENCE')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/ACCEPT_EVIDENCE`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(200)
    expect(res.body.data.state.discovery).toEqual(expect.objectContaining({
      status: 'ACCEPTED',
      accepted: true,
      needsRefresh: false,
    }))
    const persistedEvidencePack = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.evidence_pack
    expect(persistedEvidencePack).toEqual(expect.objectContaining({
      accepted: true,
      needsRefresh: false,
      acceptedBy: CUSTOMER_ADMIN_ID,
      scopedViews: persistedEvidencePack.scoped_views,
      evidence: expect.objectContaining({
        reviewSummary: {
          evidenceObjectCount: 2,
          acceptedEvidenceCount: 2,
          pendingReviewCount: 0,
          rejectedEvidenceCount: 0,
        },
      }),
      acquisition: expect.objectContaining({
        coverage: expect.objectContaining({
          evidenceObjectCount: 2,
          acceptedEvidenceCount: 2,
          pendingReviewCount: 0,
          rejectedEvidenceCount: 0,
        }),
      }),
      state: expect.objectContaining({
        status: 'ACCEPTED',
        accepted: true,
      }),
    }))
    expect(persistedEvidencePack.evidenceObjects).toEqual([
      expect.objectContaining({
        sourceId: 'input_companyWebsite',
        reviewStatus: 'ACCEPTED',
        acceptedBy: CUSTOMER_ADMIN_ID,
        acceptanceTimestamp: expect.any(String),
      }),
      expect.objectContaining({
        sourceId: 'input_targetOffer',
        reviewStatus: 'ACCEPTED',
        acceptedBy: CUSTOMER_ADMIN_ID,
        acceptanceTimestamp: expect.any(String),
      }),
    ])
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_ACTION_EXECUTED',
      diff: expect.objectContaining({
        actionKey: 'ACCEPT_EVIDENCE',
        discovery: expect.objectContaining({
          status: 'ACCEPTED',
          accepted: true,
        }),
      }),
    }))
  })

  test('POST /api/v1/runtime-instances/:id/actions/BUILD_EVIDENCE_PACK rejects when the evidence runtime path is not writable', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: {},
        sections: {},
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('BUILD_EVIDENCE_PACK')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeEvidencePackRuntimePathRecord(),
    ]))
    RuntimePathRegistry.findOne.mockReturnValue(buildLeanQuery(null))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('BUILD_EVIDENCE_PACK')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('BUILD_EVIDENCE_PACK')]))
    RuntimeInstance.findOneAndUpdate = jest.fn()
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/BUILD_EVIDENCE_PACK`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_INVALID_PATH')
    expect(res.body.error.details.runtimePath).toBe('framework_state.evidence_pack')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rolls back discovery action state when action audit persistence fails', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedBy: CUSTOMER_ADMIN_ID,
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: {},
        sections: {},
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('BUILD_EVIDENCE_PACK')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeEvidencePackRuntimePathRecord(),
    ]))
    RuntimePathRegistry.findOne.mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('BUILD_EVIDENCE_PACK')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('BUILD_EVIDENCE_PACK')]))
    RuntimeInstance.findOneAndUpdate = jest.fn()
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        framework_state: {
          ...runtimeInstanceDoc.framework_state,
          evidence_pack: makeReadyDiscoveryEvidencePack(),
        },
        updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      }))
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        updatedAt: new Date('2026-05-19T08:02:00.000Z'),
      }))
    AuditLog.createLog = jest.fn(async () => {
      throw new Error('audit unavailable')
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/BUILD_EVIDENCE_PACK`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
      })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('RUNTIME_ACTION_AUDIT_FAILED')
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_AUDIT_PERSISTENCE_FAILED')
    expect(res.body.error.details.auditError).toEqual(expect.objectContaining({
      name: 'Error',
      message: 'audit unavailable',
    }))
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(RuntimeInstance.findOneAndUpdate.mock.calls[1]).toEqual([
      {
        _id: RUNTIME_INSTANCE_ID,
        updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      },
      {
        $set: {
          framework_state: runtimeInstanceDoc.framework_state,
          executionStatus: runtimeInstanceDoc.executionStatus,
          status: runtimeInstanceDoc.status,
          lockedAt: null,
          lockedBy: null,
          lockedReason: '',
          updatedBy: CUSTOMER_ADMIN_ID,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ])
  })

  test('RUN_VALIDATION records blocked readiness when required runtime sections are missing', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {},
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('RUN_VALIDATION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('RUN_VALIDATION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('RUN_VALIDATION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: expect.objectContaining({
          executionStatus: 'BLOCKED',
          framework_state: expect.objectContaining({
            validation: expect.objectContaining({
              runtime_required_sections: expect.objectContaining({
                is_valid: false,
                status: 'FAILED',
                missingRequiredSections: [
                  {
                    sectionKey: 'customer_problem',
                    runtimePath: 'framework_state.sections.customer_problem',
                  },
                ],
              }),
            }),
            readiness: expect.objectContaining({
              state: 'BLOCKED',
              validationState: 'FAILED',
              lastActionKey: 'RUN_VALIDATION',
            }),
          }),
        }),
      },
      expect.any(Object),
    )
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_ACTION_EXECUTED',
      diff: expect.objectContaining({
        validation: expect.objectContaining({
          status: 'FAILED',
          is_valid: false,
        }),
      }),
    }))
  })

  test('rejects MARK_READY before validation evidence has passed', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('MARK_READY')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('MARK_READY')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('MARK_READY')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/MARK_READY`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toContain('Run validation successfully')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects MARK_READY when stale validation evidence no longer matches required section state', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: '',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'VALIDATED',
          validationState: 'PASSED',
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('MARK_READY')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('MARK_READY')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('MARK_READY')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/MARK_READY`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toContain('Run validation successfully')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('MARK_READY transitions a currently valid runtime to ready', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'VALIDATED',
          validationState: 'PASSED',
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('MARK_READY')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('MARK_READY')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('MARK_READY')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/MARK_READY`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: expect.objectContaining({
          executionStatus: 'IDLE',
          framework_state: expect.objectContaining({
            lifecycle: expect.objectContaining({
              stage: 'READY',
            }),
            readiness: expect.objectContaining({
              state: 'READY',
              ready: true,
              lastActionKey: 'MARK_READY',
            }),
          }),
        }),
      },
      expect.any(Object),
    )
  })

  test('SUBMIT_FOR_REVIEW transitions a ready runtime into review and waiting approval', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'READY' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'READY',
          ready: true,
          validationState: 'PASSED',
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('SUBMIT_FOR_REVIEW')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('SUBMIT_FOR_REVIEW')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('SUBMIT_FOR_REVIEW')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/SUBMIT_FOR_REVIEW`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: expect.objectContaining({
          executionStatus: 'WAITING_APPROVAL',
          framework_state: expect.objectContaining({
            lifecycle: expect.objectContaining({
              stage: 'IN_REVIEW',
            }),
            readiness: expect.objectContaining({
              state: 'IN_REVIEW',
              submittedForReview: true,
              lastActionKey: 'SUBMIT_FOR_REVIEW',
            }),
          }),
        }),
      },
      expect.any(Object),
    )
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_ACTION_EXECUTED',
      diff: expect.objectContaining({
        actionKey: 'SUBMIT_FOR_REVIEW',
        executionStatus: {
          from: 'IDLE',
          to: 'WAITING_APPROVAL',
        },
      }),
    }))
  })

  test('SAVE_DRAFT returns readiness to draft without requiring validation evidence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'READY' },
        sections: {},
        validation: {},
        readiness: {
          state: 'READY',
          ready: true,
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('SAVE_DRAFT')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('SAVE_DRAFT')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('SAVE_DRAFT')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/SAVE_DRAFT`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: expect.objectContaining({
          executionStatus: 'IDLE',
          framework_state: expect.objectContaining({
            lifecycle: expect.objectContaining({
              stage: 'DRAFT',
            }),
            readiness: expect.objectContaining({
              state: 'DRAFT',
              ready: false,
              submittedForReview: false,
              lastActionKey: 'SAVE_DRAFT',
            }),
          }),
        }),
      },
      expect.any(Object),
    )
  })

  test('RETURN_TO_DRAFT transitions an in-review runtime back to draft', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      executionStatus: 'WAITING_APPROVAL',
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'IN_REVIEW' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'IN_REVIEW',
          ready: true,
          submittedForReview: true,
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('RETURN_TO_DRAFT')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('RETURN_TO_DRAFT')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('RETURN_TO_DRAFT')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RETURN_TO_DRAFT`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: expect.objectContaining({
          executionStatus: 'IDLE',
          framework_state: expect.objectContaining({
            lifecycle: expect.objectContaining({
              stage: 'DRAFT',
            }),
            readiness: expect.objectContaining({
              state: 'DRAFT',
              ready: false,
              submittedForReview: false,
              lastActionKey: 'RETURN_TO_DRAFT',
            }),
          }),
        }),
      },
      expect.any(Object),
    )
  })

  test('APPROVE transitions an in-review runtime into approved state with audit evidence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      executionStatus: 'WAITING_APPROVAL',
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'IN_REVIEW' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'IN_REVIEW',
          ready: true,
          submittedForReview: true,
          submittedAt: '2026-05-19T07:55:00.000Z',
          validationState: 'PASSED',
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('APPROVE')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('APPROVE')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('APPROVE')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/APPROVE`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: expect.objectContaining({
          executionStatus: 'IDLE',
          framework_state: expect.objectContaining({
            lifecycle: expect.objectContaining({
              stage: 'APPROVED',
              approvedAt: expect.any(String),
              approvedBy: CUSTOMER_ADMIN_ID,
            }),
            readiness: expect.objectContaining({
              state: 'APPROVED',
              approved: true,
              lastActionKey: 'APPROVE',
            }),
          }),
        }),
      },
      expect.any(Object),
    )
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_ACTION_EXECUTED',
      diff: expect.objectContaining({
        actionKey: 'APPROVE',
        lifecycle: expect.objectContaining({
          to: expect.objectContaining({ stage: 'APPROVED' }),
        }),
      }),
    }))
  })

  test('rejects APPROVE without review submission evidence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      executionStatus: 'WAITING_APPROVAL',
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'IN_REVIEW' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'IN_REVIEW',
          ready: true,
          submittedForReview: true,
          validationState: 'PASSED',
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('APPROVE')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('APPROVE')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('APPROVE')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/APPROVE`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toContain('review submission evidence')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('PUBLISH records publish evidence only after approval and current validation', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: {
          stage: 'APPROVED',
          approvedAt: '2026-05-19T08:00:00.000Z',
          approvedBy: CUSTOMER_ADMIN_ID,
        },
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: {
              content: 'Customer Problem: Proposal creation is slow.',
              generatedAt: '2026-05-19T07:58:00.000Z',
            },
            accepted: {
              content: 'Customer Problem: Proposal creation is slow.',
              acceptedAt: '2026-05-19T07:59:00.000Z',
              acceptedBy: CUSTOMER_ADMIN_ID,
              sourceGeneratedAt: '2026-05-19T07:58:00.000Z',
            },
            review: { status: 'ACCEPTED' },
            state: { status: 'ACCEPTED' },
          },
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'APPROVED',
          approved: true,
          approvedAt: '2026-05-19T08:00:00.000Z',
          approvedBy: CUSTOMER_ADMIN_ID,
          ready: true,
          validationState: 'PASSED',
        },
        publish: {},
        lock: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('PUBLISH')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('PUBLISH')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('PUBLISH')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/PUBLISH`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(200)
    const persistedState = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state
    expect(persistedState.lifecycle).toEqual(expect.objectContaining({
      stage: 'PUBLISHED',
      publishedAt: expect.any(String),
      publishedBy: CUSTOMER_ADMIN_ID,
    }))
    expect(persistedState.publish).toEqual(expect.objectContaining({
      state: 'PUBLISHED',
      published: true,
      publishVersion: 1,
      outputEligible: true,
      evidence: expect.objectContaining({
        activationId: 'activation-vmf-2-3-1-001',
        deploymentId: 'deployment-vmf-global-production-001',
        dependencySnapshotId: 'dep-lock-vmf-standard-2-3-1',
      }),
      snapshot: expect.objectContaining({
        snapshotId: expect.stringMatching(/^runtime-truth-publish-value-narrative-439111-/),
        snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        contractVersion: 'runtime-truth-snapshot-v1',
      }),
      outputEligibility: expect.objectContaining({
        state: 'PUBLISH_ELIGIBLE',
        outputEligible: true,
        canonicalOutputEligible: false,
        snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    }))
    expect(res.body.data.state.publish).toEqual(expect.objectContaining({
      published: true,
      outputEligible: true,
    }))
  })

  test('rejects PUBLISH when accepted section truth is missing', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: {
          stage: 'APPROVED',
          approvedAt: '2026-05-19T08:00:00.000Z',
          approvedBy: CUSTOMER_ADMIN_ID,
        },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'APPROVED',
          approved: true,
          approvedAt: '2026-05-19T08:00:00.000Z',
          approvedBy: CUSTOMER_ADMIN_ID,
          ready: true,
          validationState: 'PASSED',
        },
        publish: {},
        lock: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('PUBLISH')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('PUBLISH')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('PUBLISH')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/PUBLISH`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toBe('Accepted section truth is missing.')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('rejects PUBLISH before approval evidence exists', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'READY' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'READY',
          ready: true,
          validationState: 'PASSED',
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('PUBLISH')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('PUBLISH')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('PUBLISH')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/PUBLISH`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toContain('Approve this runtime')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('rejects PUBLISH when approved labels lack approval evidence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'APPROVED' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'APPROVED',
          approved: true,
          ready: true,
          validationState: 'PASSED',
        },
        publish: {},
        lock: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('PUBLISH')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('PUBLISH')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('PUBLISH')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/PUBLISH`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toContain('Approve this runtime')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('rejects PUBLISH when runtime certification evidence is incomplete', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      evidence: {
        activationId: 'activation-vmf-2-3-1-001',
        deploymentId: 'deployment-vmf-global-production-001',
        dependencySnapshotId: 'dep-lock-vmf-standard-2-3-1',
      },
      framework_state: {
        lifecycle: {
          stage: 'APPROVED',
          approvedAt: '2026-05-19T08:00:00.000Z',
          approvedBy: CUSTOMER_ADMIN_ID,
        },
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: {
              content: 'Customer Problem: Proposal creation is slow.',
              generatedAt: '2026-05-19T07:58:00.000Z',
            },
            accepted: {
              content: 'Customer Problem: Proposal creation is slow.',
              acceptedAt: '2026-05-19T07:59:00.000Z',
              acceptedBy: CUSTOMER_ADMIN_ID,
              sourceGeneratedAt: '2026-05-19T07:58:00.000Z',
            },
            review: { status: 'ACCEPTED' },
            state: { status: 'ACCEPTED' },
          },
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'APPROVED',
          approved: true,
          approvedAt: '2026-05-19T08:00:00.000Z',
          approvedBy: CUSTOMER_ADMIN_ID,
          ready: true,
          validationState: 'PASSED',
        },
        publish: {},
        lock: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({
      document: runtimeInstanceDoc,
      rendererRuntimeInstance: makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        evidence: {
          activationId: 'activation-vmf-2-3-1-001',
          deploymentId: 'deployment-vmf-global-production-001',
          dependencySnapshotId: 'dep-lock-vmf-standard-2-3-1',
          dependencySnapshotHash: 'hash-vmf-standard-2-3-1',
        },
      }),
    })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('PUBLISH')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('PUBLISH')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('PUBLISH')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/PUBLISH`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toBe('Certified activation, deployment, and dependency snapshot evidence is required before publishing.')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('LOCK_RECORD freezes a published runtime as canonical truth', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: {
          stage: 'PUBLISHED',
          publishedAt: '2026-05-19T08:00:00.000Z',
          publishedBy: CUSTOMER_ADMIN_ID,
        },
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: {
              content: 'Customer Problem: Proposal creation is slow.',
              generatedAt: '2026-05-19T07:58:00.000Z',
            },
            accepted: {
              content: 'Customer Problem: Proposal creation is slow.',
              acceptedAt: '2026-05-19T07:59:00.000Z',
              acceptedBy: CUSTOMER_ADMIN_ID,
              sourceGeneratedAt: '2026-05-19T07:58:00.000Z',
            },
            review: { status: 'ACCEPTED' },
            state: { status: 'ACCEPTED' },
          },
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'PUBLISHED',
          published: true,
          ready: true,
          validationState: 'PASSED',
        },
        publish: {
          state: 'PUBLISHED',
          published: true,
          publishedAt: '2026-05-19T08:00:00.000Z',
          publishedBy: CUSTOMER_ADMIN_ID,
          publishVersion: 1,
          outputEligible: true,
          sourceApproval: {
            approvedAt: '2026-05-19T07:55:00.000Z',
            approvedBy: CUSTOMER_ADMIN_ID,
          },
          evidence: {
            activationId: 'activation-vmf-2-3-1-001',
            deploymentId: 'deployment-vmf-global-production-001',
            dependencySnapshotId: 'dep-lock-vmf-standard-2-3-1',
            dependencySnapshotHash: 'hash-vmf-standard-2-3-1',
          },
          snapshot: {
            snapshotId: 'runtime-truth-publish-value-narrative-439111-existing',
            snapshotHash: 'existing-publish-snapshot-hash',
            snapshotAt: '2026-05-19T08:00:00.000Z',
            contractVersion: 'runtime-truth-snapshot-v1',
          },
          outputEligibility: {
            state: 'PUBLISH_ELIGIBLE',
            outputEligible: true,
            canonicalOutputEligible: false,
          },
        },
        lock: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('LOCK_RECORD')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('LOCK_RECORD')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('LOCK_RECORD')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/LOCK_RECORD`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(200)
    const persistedSet = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set
    expect(persistedSet).toEqual(expect.objectContaining({
      status: 'LOCKED',
      executionStatus: 'COMPLETE',
      lockedAt: expect.any(Date),
      lockedBy: CUSTOMER_ADMIN_ID,
      lockedReason: 'Runtime published truth locked for downstream canonical use.',
    }))
    expect(persistedSet.framework_state.lifecycle).toEqual(expect.objectContaining({
      stage: 'LOCKED',
      lockedAt: expect.any(String),
    }))
    expect(persistedSet.framework_state.lock).toEqual(expect.objectContaining({
      state: 'LOCKED',
      locked: true,
      lockVersion: 1,
      evidence: expect.objectContaining({
        activationId: 'activation-vmf-2-3-1-001',
        deploymentId: 'deployment-vmf-global-production-001',
      }),
      snapshot: expect.objectContaining({
        snapshotId: expect.stringMatching(/^runtime-truth-lock-record-value-narrative-439111-/),
        snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        contractVersion: 'runtime-truth-snapshot-v1',
      }),
      anchor: expect.objectContaining({
        replayAnchorId: expect.stringMatching(/^runtime-replay-anchor-/),
        relationship: 'LOCKED_VALUE_NARRATIVE',
        runtimeInstanceKey: 'value-narrative-439111',
        publishSnapshotId: 'runtime-truth-publish-value-narrative-439111-existing',
        lockSnapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      outputEligibility: expect.objectContaining({
        state: 'OUTPUT_ELIGIBLE',
        outputEligible: true,
        canonicalOutputEligible: true,
        anchorEligible: true,
      }),
    }))
    expect(res.body.data.runtimeInstance).toEqual(expect.objectContaining({
      status: 'LOCKED',
      executionStatus: 'COMPLETE',
      lockedAt: expect.any(String),
    }))
  })

  test('rejects LOCK_RECORD when current runtime evidence drifts from published evidence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      evidence: {
        activationId: 'activation-vmf-2-3-1-001',
        deploymentId: 'deployment-vmf-global-production-001',
        dependencySnapshotId: 'dep-lock-vmf-standard-2-3-1',
        dependencySnapshotHash: 'hash-vmf-standard-2-3-1-drifted',
      },
      framework_state: {
        lifecycle: {
          stage: 'PUBLISHED',
          publishedAt: '2026-05-19T08:00:00.000Z',
          publishedBy: CUSTOMER_ADMIN_ID,
        },
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: {
              content: 'Customer Problem: Proposal creation is slow.',
              generatedAt: '2026-05-19T07:58:00.000Z',
            },
            accepted: {
              content: 'Customer Problem: Proposal creation is slow.',
              acceptedAt: '2026-05-19T07:59:00.000Z',
              acceptedBy: CUSTOMER_ADMIN_ID,
              sourceGeneratedAt: '2026-05-19T07:58:00.000Z',
            },
            review: { status: 'ACCEPTED' },
            state: { status: 'ACCEPTED' },
          },
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'PUBLISHED',
          published: true,
          ready: true,
          validationState: 'PASSED',
        },
        publish: {
          state: 'PUBLISHED',
          published: true,
          publishedAt: '2026-05-19T08:00:00.000Z',
          publishedBy: CUSTOMER_ADMIN_ID,
          publishVersion: 1,
          outputEligible: true,
          sourceApproval: {
            approvedAt: '2026-05-19T07:55:00.000Z',
            approvedBy: CUSTOMER_ADMIN_ID,
          },
          evidence: {
            activationId: 'activation-vmf-2-3-1-001',
            deploymentId: 'deployment-vmf-global-production-001',
            dependencySnapshotId: 'dep-lock-vmf-standard-2-3-1',
            dependencySnapshotHash: 'hash-vmf-standard-2-3-1',
          },
          snapshot: {
            snapshotId: 'runtime-truth-publish-value-narrative-439111-existing',
            snapshotHash: 'existing-publish-snapshot-hash',
            snapshotAt: '2026-05-19T08:00:00.000Z',
            contractVersion: 'runtime-truth-snapshot-v1',
          },
          outputEligibility: {
            state: 'PUBLISH_ELIGIBLE',
            outputEligible: true,
            canonicalOutputEligible: false,
          },
        },
        lock: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({
      document: runtimeInstanceDoc,
      rendererRuntimeInstance: makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        evidence: {
          activationId: 'activation-vmf-2-3-1-001',
          deploymentId: 'deployment-vmf-global-production-001',
          dependencySnapshotId: 'dep-lock-vmf-standard-2-3-1',
          dependencySnapshotHash: 'hash-vmf-standard-2-3-1',
        },
      }),
    })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('LOCK_RECORD')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('LOCK_RECORD')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('LOCK_RECORD')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/LOCK_RECORD`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toBe('Current runtime evidence must match the published VMF evidence before locking canonical truth.')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects LOCK_RECORD when accepted section truth is stale', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: {
          stage: 'PUBLISHED',
          publishedAt: '2026-05-19T08:00:00.000Z',
          publishedBy: CUSTOMER_ADMIN_ID,
        },
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow after a packaging change.',
            generated: {
              content: 'Customer Problem: Proposal creation is slow.',
              generatedAt: '2026-05-19T07:58:00.000Z',
              inputHash: 'hash-before-change',
            },
            accepted: {
              content: 'Customer Problem: Proposal creation is slow.',
              acceptedAt: '2026-05-19T07:59:00.000Z',
              acceptedBy: CUSTOMER_ADMIN_ID,
              sourceGeneratedAt: '2026-05-19T07:58:00.000Z',
              inputHash: 'hash-before-change',
            },
            review: { status: 'ACCEPTED' },
            state: { status: 'ACCEPTED' },
          },
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'PUBLISHED',
          published: true,
          ready: true,
          validationState: 'PASSED',
        },
        publish: {
          state: 'PUBLISHED',
          published: true,
          publishedAt: '2026-05-19T08:00:00.000Z',
          publishedBy: CUSTOMER_ADMIN_ID,
          publishVersion: 1,
          outputEligible: true,
          sourceApproval: {
            approvedAt: '2026-05-19T07:55:00.000Z',
            approvedBy: CUSTOMER_ADMIN_ID,
          },
          evidence: {
            activationId: 'activation-vmf-2-3-1-001',
            deploymentId: 'deployment-vmf-global-production-001',
            dependencySnapshotId: 'dep-lock-vmf-standard-2-3-1',
            dependencySnapshotHash: 'hash-vmf-standard-2-3-1',
          },
          snapshot: {
            snapshotId: 'runtime-truth-publish-value-narrative-439111-existing',
            snapshotHash: 'existing-publish-snapshot-hash',
            snapshotAt: '2026-05-19T08:00:00.000Z',
            contractVersion: 'runtime-truth-snapshot-v1',
          },
          outputEligibility: {
            state: 'PUBLISH_ELIGIBLE',
            outputEligible: true,
            canonicalOutputEligible: false,
          },
        },
        lock: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('LOCK_RECORD')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('LOCK_RECORD')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('LOCK_RECORD')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/LOCK_RECORD`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toBe('Accepted section truth is not aligned with current generated content.')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('rejects LOCK_RECORD before publish evidence exists', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'PUBLISHED' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'PUBLISHED',
          approved: true,
          published: true,
          ready: true,
          validationState: 'PASSED',
        },
        publish: {},
        lock: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('LOCK_RECORD')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('LOCK_RECORD')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('LOCK_RECORD')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/LOCK_RECORD`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toContain('Publish this runtime')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('rejects LOCK_RECORD when publish evidence is partial', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: {
          stage: 'PUBLISHED',
          publishedAt: '2026-05-19T08:00:00.000Z',
          publishedBy: CUSTOMER_ADMIN_ID,
        },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'PUBLISHED',
          approved: true,
          published: true,
          ready: true,
          validationState: 'PASSED',
        },
        publish: {
          state: 'PUBLISHED',
          published: true,
          publishedAt: '2026-05-19T08:00:00.000Z',
          outputEligible: true,
          evidence: {
            activationId: 'activation-vmf-2-3-1-001',
          },
        },
        lock: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('LOCK_RECORD')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('LOCK_RECORD')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('LOCK_RECORD')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/LOCK_RECORD`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toContain('Publish this runtime')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test.each([
    ['APPROVED', 'approved'],
    ['PUBLISHED', 'published'],
  ])('rejects section mutation after a runtime is %s', async (lifecycleStage, messageFragment) => {
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:10:00.000Z'),
      framework_state: {
        lifecycle: { stage: lifecycleStage },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: lifecycleStage,
        },
        publish: {},
        lock: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Mutating locked truth.',
        expectedUpdatedAt: '2026-05-19T08:10:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_NOT_EDITABLE')
    expect(res.body.error.message).toContain(messageFragment)
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects section mutation after a runtime is locked', async () => {
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(makeRuntimeInstanceDocument({
      status: 'LOCKED',
      executionStatus: 'COMPLETE',
      lockedAt: new Date('2026-05-19T08:10:00.000Z'),
      updatedAt: new Date('2026-05-19T08:10:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'LOCKED' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'LOCKED',
          locked: true,
        },
        publish: {
          state: 'PUBLISHED',
          published: true,
          publishedAt: '2026-05-19T08:00:00.000Z',
        },
        lock: {
          state: 'LOCKED',
          locked: true,
          lockedAt: '2026-05-19T08:10:00.000Z',
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Mutating locked truth.',
        expectedUpdatedAt: '2026-05-19T08:10:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_NOT_EDITABLE')
    expect(res.body.error.message).toContain('locked')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects mutating runtime actions after lock', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      status: 'LOCKED',
      executionStatus: 'COMPLETE',
      lockedAt: new Date('2026-05-19T08:10:00.000Z'),
      updatedAt: new Date('2026-05-19T08:10:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'LOCKED' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'LOCKED',
          locked: true,
        },
        publish: {
          state: 'PUBLISHED',
          published: true,
          publishedAt: '2026-05-19T08:00:00.000Z',
        },
        lock: {
          state: 'LOCKED',
          locked: true,
          lockedAt: '2026-05-19T08:10:00.000Z',
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('RUN_VALIDATION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('RUN_VALIDATION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('RUN_VALIDATION')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:10:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toContain('locked')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('GENERATE_SECTION persists governed generated content and audit evidence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
        }),
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('GENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('GENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('GENERATE_SECTION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/GENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        runtimePath: 'framework_state.sections.customer_problem',
      })

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: expect.objectContaining({
          executionStatus: 'IDLE',
          framework_state: expect.objectContaining({
            sections: expect.objectContaining({
              customer_problem: expect.objectContaining({
                input: 'Proposal creation is slow.',
                generated: expect.objectContaining({
                  format: 'STRUCTURED_TEXT',
                  content: expect.stringContaining('Based on accepted Intelligence Hub evidence'),
                  sections: expect.arrayContaining([
                    expect.objectContaining({
                      heading: 'Customer-Provided Section Context',
                      body: expect.stringContaining('included in generation as section input'),
                      bullets: expect.arrayContaining([
                        'Proposal creation is slow.',
                      ]),
                    }),
                  ]),
                  actionKey: 'GENERATE_SECTION',
                  supportingEvidenceRefs: expect.arrayContaining([
                    'section_input',
                  ]),
                  evidenceHash: expect.any(String),
                  dependencyHash: expect.any(String),
                  boundedContextHash: expect.any(String),
                  truthEligibility: expect.objectContaining({
                    eligible: true,
                    status: 'ELIGIBLE',
                  }),
                  generator: expect.objectContaining({
                    mode: 'DETERMINISTIC_PLUS_BOUNDED_SYNTHESIS',
                    adapter: 'gsil-section-enrichment-v1',
                  }),
                  inputHash: expect.any(String),
                }),
                intelligence: expect.objectContaining({
                  displayProjection: expect.objectContaining({
                    suggestedFromDiscovery: expect.objectContaining({
                      bullets: expect.arrayContaining([
                        'Offer-led business context',
                      ]),
                    }),
                    generatedInsight: expect.objectContaining({
                      title: 'Generated Insight',
                    }),
                    supportingEvidence: expect.objectContaining({
                      items: expect.arrayContaining([
                        expect.stringContaining('Target offer: Managed proposal platform'),
                      ]),
                    }),
                    boundaries: expect.objectContaining({
                      items: expect.arrayContaining([
                        expect.stringContaining('No quantified commercial proof has been provided.'),
                      ]),
                    }),
                  }),
                  truthEligibility: expect.objectContaining({
                    eligible: true,
                    status: 'ELIGIBLE',
                  }),
                  tokenSafety: expect.objectContaining({
                    sectionOnly: true,
                    usedFullRuntime: false,
                    usedFullEvidenceCorpus: false,
                  }),
                }),
                review: expect.objectContaining({
                  status: 'PENDING_REVIEW',
                }),
                state: expect.objectContaining({
                  status: 'GENERATED',
                  lastActionKey: 'GENERATE_SECTION',
                  revisionCount: 0,
                }),
                lineage: expect.objectContaining({
                  sectionKey: 'customer_problem',
                  runtimePath: 'framework_state.sections.customer_problem',
                  actionKey: 'GENERATE_SECTION',
                  inputHash: expect.any(String),
                }),
                revisions: [],
              }),
            }),
            validation: {},
            readiness: expect.objectContaining({
              state: 'DRAFT',
              ready: false,
              submittedForReview: false,
              validationState: 'UNKNOWN',
              invalidatedByRuntimePath: 'framework_state.sections.customer_problem',
              invalidatedAt: expect.any(String),
            }),
          }),
        }),
      },
      expect.any(Object),
    )
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_ACTION_EXECUTED',
      diff: expect.objectContaining({
        actionKey: 'GENERATE_SECTION',
        generation: expect.objectContaining({
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          revisionCount: 0,
          previousGenerated: false,
          inputHash: expect.any(String),
          evidenceHash: expect.any(String),
          dependencyHash: expect.any(String),
          boundedContextHash: expect.any(String),
          truthEligibility: expect.objectContaining({
            eligible: true,
            status: 'ELIGIBLE',
          }),
        }),
      }),
    }))
    expect(res.body.data.state.generation).toEqual(expect.objectContaining({
      sectionKey: 'customer_problem',
      runtimePath: 'framework_state.sections.customer_problem',
      revisionCount: 0,
    }))
  })

  test('GENERATE_SECTION produces evidence-bound Value Drivers intelligence without unsupported claims', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          inputs: {
            companyWebsite: 'https://storylineos.example',
            companyName: 'StorylineOS',
            marketRegion: 'UK enterprise software',
            targetOffer: 'AI-native value management and governed output platform',
            notes: 'Helps teams create framework-bound value narratives and downstream outputs.',
          },
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
          scoped_views: {
            value_drivers: {
              source: 'DISCOVERY_EVIDENCE_PACK',
              summary: 'Accepted Intelligence Hub evidence supports governed value narrative workflow themes. Website body: StylableButton2545352419__root{-archetype:box;cursor:pointer;box-sizing:border-box;width:100%;height:100%;display:block}',
              sourceRefs: ['input_targetOffer', 'input_notes'],
            },
          },
        }),
        sections: {
          value_drivers: '',
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
          validationKeys: ['required-sections-check'],
        },
      ],
      workflowBindings: [makeWorkflowBinding('GENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-value-drivers',
        pathKey: 'framework_state.sections.value_drivers',
        label: 'Value Drivers',
      }),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          source: 'PACKAGE',
          isCustom: false,
          label: 'Value Drivers',
          displayOrder: 10,
          isVisible: true,
          isEditable: true,
        },
      ],
      actions: [makeUIAction('GENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('GENERATE_SECTION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/GENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        sectionKey: 'value_drivers',
        additionalContext: 'The strongest customer value is reducing time spent creating enterprise-grade value narratives.',
        generationMode: 'ENRICHED_SECTION_TRUTH',
      })

    expect(res.status).toBe(200)
    const persistedSection = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.sections.value_drivers
    expect(persistedSection.input).toBe(
      'The strongest customer value is reducing time spent creating enterprise-grade value narratives.',
    )
    expect(persistedSection.generated).toEqual(expect.objectContaining({
      format: 'STRUCTURED_TEXT',
      content: expect.stringContaining('Primary Value Drivers'),
      sections: expect.arrayContaining([
        expect.objectContaining({
          heading: 'Customer-Provided Section Context',
          bullets: expect.arrayContaining([
            'The strongest customer value is reducing time spent creating enterprise-grade value narratives.',
          ]),
        }),
      ]),
      supportingEvidenceRefs: expect.arrayContaining([
        'section_input',
      ]),
      generationBoundaries: expect.arrayContaining([
        'No quantified ROI has been provided.',
        'No named customer proof has been provided.',
      ]),
      truthEligibility: expect.objectContaining({
        eligible: true,
        status: 'ELIGIBLE',
      }),
    }))
    expect(persistedSection.generated.content).not.toMatch(/\b\d+%|\bROI of\b|competitor/i)
    expect(persistedSection.intelligence.displayProjection.suggestedFromDiscovery.bullets).toEqual(expect.arrayContaining([
      'Reduced manual workflow overhead',
      'Governed execution and risk control',
    ]))
    expect(persistedSection.intelligence.displayProjection.supportingEvidence.items).toEqual(expect.arrayContaining([
      expect.stringContaining('Target offer: AI-native value management and governed output platform'),
    ]))
    expect(persistedSection.intelligence.displayProjection.supportingEvidence.items.join(' ')).not.toMatch(
      /StylableButton|box-sizing|width:100%/,
    )
    expect(res.body.data.state.generation).toEqual(expect.objectContaining({
      sectionKey: 'value_drivers',
      truthEligibility: expect.objectContaining({
        eligible: true,
        status: 'ELIGIBLE',
      }),
    }))
  })

  test('GENERATE_SECTION records insufficient evidence instead of filler when accepted context is too weak', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          inputs: {
            companyWebsite: 'https://thin.example',
            companyName: 'Thin Context Co',
            marketRegion: '',
            targetOffer: '',
          },
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
          scoped_views: {
            value_drivers: {
              source: 'DISCOVERY_EVIDENCE_PACK',
              summary: '',
              sourceRefs: ['input_companyName'],
            },
          },
        }),
        sections: {
          value_drivers: '',
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
          validationKeys: ['required-sections-check'],
        },
      ],
      workflowBindings: [makeWorkflowBinding('GENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-value-drivers',
        pathKey: 'framework_state.sections.value_drivers',
        label: 'Value Drivers',
      }),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          source: 'PACKAGE',
          isCustom: false,
          label: 'Value Drivers',
          displayOrder: 10,
          isVisible: true,
          isEditable: true,
        },
      ],
      actions: [makeUIAction('GENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('GENERATE_SECTION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/GENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        sectionKey: 'value_drivers',
      })

    expect(res.status).toBe(200)
    const persistedSection = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.sections.value_drivers
    expect(persistedSection.state.status).toBe('INSUFFICIENT_EVIDENCE')
    expect(persistedSection.generated.content).toContain('Evidence not sufficient to derive this section safely.')
    expect(persistedSection.generated.truthEligibility).toEqual(expect.objectContaining({
      eligible: false,
      status: 'INSUFFICIENT_EVIDENCE',
    }))
    expect(persistedSection.generated.content).not.toMatch(/\b\d+%|\bROI of\b|competitor/i)
  })

  test('GENERATE_SECTION treats section-scoped evidence as eligible business context', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          inputs: {
            companyWebsite: 'https://scoped.example',
            companyName: 'Scoped Context Co',
            marketRegion: '',
            targetOffer: '',
            notes: '',
          },
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
          scoped_views: {
            value_drivers: {
              source: 'DISCOVERY_EVIDENCE_PACK',
              summary: 'Accepted scoped evidence describes governed workflow automation, structured narrative output, and reduced manual cycle effort.',
              sourceRefs: ['input_companyWebsite'],
            },
          },
        }),
        sections: {
          value_drivers: '',
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
          validationKeys: ['required-sections-check'],
        },
      ],
      workflowBindings: [makeWorkflowBinding('GENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-value-drivers',
        pathKey: 'framework_state.sections.value_drivers',
        label: 'Value Drivers',
      }),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          source: 'PACKAGE',
          isCustom: false,
          label: 'Value Drivers',
          displayOrder: 10,
          isVisible: true,
          isEditable: true,
        },
      ],
      actions: [makeUIAction('GENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('GENERATE_SECTION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/GENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        sectionKey: 'value_drivers',
      })

    expect(res.status).toBe(200)
    const persistedSection = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.sections.value_drivers
    expect(persistedSection.state.status).toBe('GENERATED')
    expect(persistedSection.generated.content).toContain('Primary Value Drivers')
    expect(persistedSection.generated.truthEligibility).toEqual(expect.objectContaining({
      eligible: true,
      status: 'ELIGIBLE',
    }))
    expect(persistedSection.intelligence.truthEligibility).toEqual(expect.objectContaining({
      eligible: true,
      status: 'ELIGIBLE',
    }))
    expect(persistedSection.intelligence.supportingEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Section-scoped evidence view',
        summary: expect.stringContaining('governed workflow automation'),
      }),
    ]))
  })

  test('GENERATE_SECTION uses accepted section evidence objects and excludes pending section evidence', async () => {
    const acceptedFact = 'Document Section Supporting File: governed workflow automation reduces manual proposal effort.'
    const pendingFact = 'Pending section evidence says unsupported competitor displacement is guaranteed.'
    const acceptedSectionEvidence = makeSectionEvidenceObject({
      evidenceObjectId: 'section_evidence_accepted_fixture',
      extractedFact: acceptedFact,
      reviewStatus: 'ACCEPTED',
      acceptedBy: CUSTOMER_ADMIN_ID,
      acceptanceTimestamp: '2026-05-19T08:02:00.000Z',
    })
    const pendingSectionEvidence = makeSectionEvidenceObject({
      evidenceObjectId: 'section_evidence_pending_fixture',
      extractedFact: pendingFact,
      reviewStatus: 'PENDING',
    })
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
          scoped_views: {},
        }),
        sections: {
          value_drivers: {
            input: '',
            additionalEvidence: makeSectionAdditionalEvidence({
              evidenceObjects: [acceptedSectionEvidence, pendingSectionEvidence],
              status: 'PENDING_REVIEW',
            }),
            evidenceObjects: [acceptedSectionEvidence, pendingSectionEvidence],
          },
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
          validationKeys: ['required-sections-check'],
        },
      ],
      workflowBindings: [makeWorkflowBinding('GENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-value-drivers',
        pathKey: 'framework_state.sections.value_drivers',
        label: 'Value Drivers',
      }),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          source: 'PACKAGE',
          isCustom: false,
          label: 'Value Drivers',
          displayOrder: 10,
          isVisible: true,
          isEditable: true,
        },
      ],
      actions: [makeUIAction('GENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('GENERATE_SECTION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/GENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        sectionKey: 'value_drivers',
      })

    expect(res.status).toBe(200)
    const persistedSection = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.sections.value_drivers
    expect(persistedSection.state.status).toBe('GENERATED')
    expect(persistedSection.generated.sectionEvidenceHash).toEqual(expect.any(String))
    expect(persistedSection.generated.content).toContain('Customer-Provided Section Evidence')
    expect(persistedSection.generated.content).toContain(acceptedFact)
    expect(persistedSection.generated.content).not.toContain(pendingFact)
    expect(persistedSection.generated.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        heading: 'Customer-Provided Section Evidence',
        body: expect.stringContaining('included in generation as section evidence'),
        bullets: expect.arrayContaining([
          acceptedFact,
        ]),
      }),
    ]))
    expect(persistedSection.intelligence.supportingEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Value Drivers',
        sourceType: 'SECTION_EVIDENCE_OBJECT',
        refKey: 'section_evidence_accepted_fixture',
        summary: expect.stringContaining('governed workflow automation reduces manual proposal effort'),
      }),
    ]))
    expect(persistedSection.generated.supportingEvidenceRefs).toEqual(expect.arrayContaining([
      'section_evidence_accepted_fixture',
    ]))
    expect(JSON.stringify(persistedSection.intelligence.supportingEvidence)).not.toContain(pendingFact)
    expect(JSON.stringify(persistedSection.generated.supportingEvidenceRefs)).not.toContain('section_evidence_pending_fixture')
  })

  test('GENERATE_SECTION uses accepted Evidence Objects and excludes rejected Discovery facts', async () => {
    const acceptedFact = 'Document Customer Notes: governed workflow automation reduces manual proposal effort.'
    const rejectedFact = 'Rejected competitor claim: Acme beats every competitor by 90%.'
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          evidenceObjects: [
            makeDiscoveryEvidenceObject({
              evidenceObjectId: 'evidence_document_value_fixture',
              sourceId: 'document_customer_notes',
              category: 'Value Drivers',
              coverageArea: 'Decision Context',
              extractedFact: acceptedFact,
              reviewStatus: 'ACCEPTED',
              acquisitionMethod: 'DOCUMENT_INGESTION',
              acceptedBy: CUSTOMER_ADMIN_ID,
              acceptanceTimestamp: '2026-05-19T08:01:00.000Z',
              lineageRef: 'lineage:document_customer_notes:value',
            }),
            makeDiscoveryEvidenceObject({
              evidenceObjectId: 'evidence_rejected_competitor_fixture',
              sourceId: 'document_customer_notes',
              category: 'Proof',
              coverageArea: 'Proof',
              extractedFact: rejectedFact,
              reviewStatus: 'REJECTED',
              acquisitionMethod: 'DOCUMENT_INGESTION',
              rejectedBy: CUSTOMER_ADMIN_ID,
              rejectionTimestamp: '2026-05-19T08:01:00.000Z',
              lineageRef: 'lineage:document_customer_notes:rejected',
            }),
          ],
          scoped_views: {
            value_drivers: {
              source: 'DISCOVERY_EVIDENCE_OBJECTS',
              summary: acceptedFact,
              evidenceObjectIds: ['evidence_document_value_fixture'],
              sourceRefs: ['document_customer_notes'],
              evidenceFacts: [
                {
                  evidenceObjectId: 'evidence_document_value_fixture',
                  sourceId: 'document_customer_notes',
                  category: 'Value Drivers',
                  coverageArea: 'Decision Context',
                  extractedFact: acceptedFact,
                },
              ],
            },
          },
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
        }),
        sections: {
          value_drivers: '',
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
          validationKeys: ['required-sections-check'],
        },
      ],
      workflowBindings: [makeWorkflowBinding('GENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-value-drivers',
        pathKey: 'framework_state.sections.value_drivers',
        label: 'Value Drivers',
      }),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          source: 'PACKAGE',
          isCustom: false,
          label: 'Value Drivers',
          displayOrder: 10,
          isVisible: true,
          isEditable: true,
        },
      ],
      actions: [makeUIAction('GENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('GENERATE_SECTION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/GENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        sectionKey: 'value_drivers',
      })

    expect(res.status).toBe(200)
    const persistedSection = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.sections.value_drivers
    const generatedJson = JSON.stringify(persistedSection.generated)
    const intelligenceJson = JSON.stringify(persistedSection.intelligence)
    expect(persistedSection.state.status).toBe('GENERATED')
    expect(intelligenceJson).toContain(acceptedFact)
    expect(generatedJson).not.toContain('90%')
    expect(intelligenceJson).not.toContain('90%')
    expect(intelligenceJson).not.toContain('beats every competitor')
    expect(persistedSection.intelligence.supportingEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: 'DISCOVERY_EVIDENCE_OBJECT',
        refKey: 'evidence_document_value_fixture',
        summary: acceptedFact,
      }),
    ]))
  })

  test('rejects direct GENERATE_SECTION when target section has no eligible context', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: '',
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('GENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('GENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('GENERATE_SECTION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn()
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/GENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        runtimePath: 'framework_state.sections.customer_problem',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toBe('Accept Intelligence Hub evidence before generating this section.')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects direct GENERATE_SECTION when an archived generated baseline exists', async () => {
    const previousInput = 'Proposal creation is slow.'
    const changedInput = 'Proposal teams lack a shared story.'
    const archivedGenerated = {
      content: 'Customer Problem: Proposal creation is slow.',
      generatedAt: '2026-05-19T07:55:00.000Z',
      actionKey: 'GENERATE_SECTION',
      inputHash: hashSectionInput(previousInput),
      generator: {
        mode: 'DETERMINISTIC_TEMPLATE',
        adapter: 'runtime-section-template-v1',
        packageKey: 'vmf-standard-2-3-1',
        packageVersion: '2.3.1',
      },
    }
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
        }),
        sections: {
          customer_problem: {
            input: changedInput,
            generated: null,
            accepted: null,
            review: {
              status: 'PENDING_REVIEW',
              invalidationReason: 'SECTION_INPUT_CHANGED',
            },
            state: {
              status: 'DRAFT',
              revisionCount: 1,
              invalidationReason: 'SECTION_INPUT_CHANGED',
            },
            lineage: {
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
            },
            revisions: [
              {
                revisionNumber: 1,
                generated: archivedGenerated,
                replacedAt: '2026-05-19T08:00:30.000Z',
                reason: 'SECTION_INPUT_CHANGED',
              },
            ],
          },
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('GENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('GENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('GENERATE_SECTION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn()
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/GENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        sectionKey: 'customer_problem',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toBe(
      'Regenerate this section because previous generated content is archived for comparison.',
    )
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('GENERATE_SECTION writes generated content under the runtime path section key', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
        }),
        sections: {
          section_1_executive_summary: 'Show the board why proposal creation is slow.',
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'section-executive-summary',
          runtimePath: 'framework_state.sections.section_1_executive_summary',
          required: true,
          validationKeys: ['required-sections-check'],
        },
      ],
      workflowBindings: [makeWorkflowBinding('GENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord({
        pathKey: 'framework_state.sections.section_1_executive_summary',
        label: 'Executive Summary',
      }),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        {
          sectionKey: 'section-executive-summary',
          runtimePath: 'framework_state.sections.section_1_executive_summary',
          source: 'PACKAGE',
          isCustom: false,
          label: 'Executive Summary',
          displayOrder: 10,
          isVisible: true,
          isEditable: true,
        },
      ],
      actions: [makeUIAction('GENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('GENERATE_SECTION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/GENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        sectionKey: 'section-executive-summary',
        runtimePath: 'framework_state.sections.section_1_executive_summary',
      })

    expect(res.status).toBe(200)
    const persistedSections = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.sections
    expect(persistedSections).toEqual(expect.objectContaining({
      section_1_executive_summary: expect.objectContaining({
        input: 'Show the board why proposal creation is slow.',
        generated: expect.objectContaining({
          format: 'STRUCTURED_TEXT',
          content: expect.stringContaining('Strategic Overview'),
          actionKey: 'GENERATE_SECTION',
          generator: expect.objectContaining({
            adapter: 'gsil-section-enrichment-v1',
          }),
        }),
        intelligence: expect.objectContaining({
          displayProjection: expect.objectContaining({
            generatedInsight: expect.objectContaining({
              title: 'Generated Insight',
            }),
          }),
        }),
        lineage: expect.objectContaining({
          sectionKey: 'section-executive-summary',
          stateSectionKey: 'section_1_executive_summary',
          runtimePath: 'framework_state.sections.section_1_executive_summary',
        }),
      }),
    }))
    expect(persistedSections['section-executive-summary']).toBeUndefined()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      diff: expect.objectContaining({
        generation: expect.objectContaining({
          sectionKey: 'section-executive-summary',
          stateSectionKey: 'section_1_executive_summary',
          runtimePath: 'framework_state.sections.section_1_executive_summary',
        }),
      }),
    }))
    expect(res.body.data.state.generation).toEqual(expect.objectContaining({
      sectionKey: 'section-executive-summary',
      stateSectionKey: 'section_1_executive_summary',
    }))
  })

  test('REGENERATE_SECTION preserves previous generated content as a revision', async () => {
    const previousGenerated = {
      content: 'Customer Problem: Earlier generated narrative.',
      generatedAt: '2026-05-19T07:55:00.000Z',
      actionKey: 'GENERATE_SECTION',
      inputHash: 'old-input-hash',
    }
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
        }),
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: previousGenerated,
            review: { status: 'PENDING_REVIEW' },
            state: { status: 'GENERATED', revisionCount: 0 },
            lineage: {
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
            },
            revisions: [],
          },
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('REGENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('REGENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('REGENERATE_SECTION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/REGENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        sectionKey: 'customer_problem',
      })

    expect(res.status).toBe(200)
    const persistedFrameworkState = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state
    expect(persistedFrameworkState.sections.customer_problem).toEqual(expect.objectContaining({
      input: 'Proposal creation is slow.',
      generated: expect.objectContaining({
        format: 'STRUCTURED_TEXT',
        content: expect.stringContaining('Based on accepted Intelligence Hub evidence'),
        actionKey: 'REGENERATE_SECTION',
        generator: expect.objectContaining({
          adapter: 'gsil-section-enrichment-v1',
        }),
      }),
      intelligence: expect.objectContaining({
        truthEligibility: expect.objectContaining({
          eligible: true,
          status: 'ELIGIBLE',
        }),
      }),
      state: expect.objectContaining({
        status: 'REGENERATED',
        revisionCount: 1,
      }),
      revisions: [
        expect.objectContaining({
          revisionNumber: 1,
          generated: previousGenerated,
          replacedAt: expect.any(String),
        }),
      ],
    }))
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      diff: expect.objectContaining({
        actionKey: 'REGENERATE_SECTION',
        generation: expect.objectContaining({
          sectionKey: 'customer_problem',
          revisionCount: 1,
          previousGenerated: true,
        }),
      }),
    }))
  })

  test('REGENERATE_SECTION archives accepted truth when additional context changes the section input', async () => {
    const previousInput = 'Proposal creation is slow.'
    const changedAdditionalContext = 'Proposal teams lack a shared story for executive value.'
    const previousGenerated = {
      content: 'Customer Problem: Proposal creation is slow.',
      generatedAt: '2026-05-19T07:55:00.000Z',
      actionKey: 'GENERATE_SECTION',
      inputHash: hashSectionInput(previousInput),
      generator: {
        mode: 'DETERMINISTIC_PLUS_BOUNDED_SYNTHESIS',
        adapter: 'gsil-section-enrichment-v1',
        packageKey: 'vmf-standard-2-3-1',
        packageVersion: '2.3.1',
      },
    }
    const previousAccepted = {
      content: 'Customer Problem: Accepted truth for slow proposal creation.',
      acceptedAt: '2026-05-19T07:56:00.000Z',
      acceptedBy: CUSTOMER_ADMIN_ID,
      sourceGeneratedAt: previousGenerated.generatedAt,
      inputHash: hashSectionInput(previousInput),
      truthHash: 'sha256:accepted-customer-problem',
    }
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
        }),
        sections: {
          customer_problem: {
            input: previousInput,
            generated: previousGenerated,
            accepted: previousAccepted,
            review: {
              status: 'ACCEPTED',
              acceptedAt: previousAccepted.acceptedAt,
            },
            state: {
              status: 'ACCEPTED',
              revisionCount: 0,
              inputHash: hashSectionInput(previousInput),
            },
            lineage: {
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
            },
            revisions: [],
          },
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('REGENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('REGENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('REGENERATE_SECTION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/REGENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        sectionKey: 'customer_problem',
        additionalContext: changedAdditionalContext,
      })

    expect(res.status).toBe(200)
    const persistedSection = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.sections.customer_problem
    expect(persistedSection.input).toBe(changedAdditionalContext)
    expect(persistedSection.accepted).toBeNull()
    expect(persistedSection.generated).toEqual(expect.objectContaining({
      actionKey: 'REGENERATE_SECTION',
      inputHash: hashSectionInput(changedAdditionalContext),
    }))
    expect(persistedSection.revisions).toEqual([
      expect.objectContaining({
        revisionNumber: 1,
        generated: previousGenerated,
        accepted: previousAccepted,
        reason: 'SECTION_INPUT_CHANGED',
        replacedAt: expect.any(String),
      }),
    ])
    expect(persistedSection.review).toEqual(expect.objectContaining({
      status: 'PENDING_REVIEW',
      invalidationReason: 'SECTION_INPUT_CHANGED',
      invalidatedAt: expect.any(String),
    }))
    expect(persistedSection.state).toEqual(expect.objectContaining({
      status: 'REGENERATED',
      revisionCount: 1,
      inputHash: hashSectionInput(changedAdditionalContext),
      acceptedInvalidationReason: 'SECTION_INPUT_CHANGED',
      acceptedInvalidatedAt: expect.any(String),
    }))
    expect(persistedSection.intelligence.invalidation).toEqual(expect.objectContaining({
      reason: 'SECTION_INPUT_CHANGED',
      archivedRevisionNumber: 1,
      invalidatedAt: expect.any(String),
    }))
  })

  test('REGENERATE_SECTION uses archived generated truth after section input invalidation', async () => {
    const previousInput = 'Proposal creation is slow.'
    const changedInput = 'Proposal teams lack a shared story.'
    const archivedGenerated = {
      content: 'Customer Problem: Proposal creation is slow.',
      generatedAt: '2026-05-19T07:55:00.000Z',
      actionKey: 'GENERATE_SECTION',
      inputHash: hashSectionInput(previousInput),
      generator: {
        mode: 'DETERMINISTIC_TEMPLATE',
        adapter: 'runtime-section-template-v1',
        packageKey: 'vmf-standard-2-3-1',
        packageVersion: '2.3.1',
      },
    }
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
        }),
        sections: {
          customer_problem: {
            input: changedInput,
            generated: null,
            accepted: null,
            review: {
              status: 'PENDING_REVIEW',
              invalidationReason: 'SECTION_INPUT_CHANGED',
            },
            state: {
              status: 'DRAFT',
              revisionCount: 1,
              invalidationReason: 'SECTION_INPUT_CHANGED',
            },
            lineage: {
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
            },
            dependencies: {
              state: 'SATISFIED',
              requiredSectionKeys: [],
              satisfiedSectionKeys: [],
              missingSectionKeys: [],
              invalidatedSectionKeys: [],
            },
            revisions: [
              {
                revisionNumber: 1,
                generated: archivedGenerated,
                accepted: {
                  content: 'Accepted customer problem truth.',
                  acceptedAt: '2026-05-19T07:56:00.000Z',
                },
                replacedAt: '2026-05-19T08:00:30.000Z',
                reason: 'SECTION_INPUT_CHANGED',
              },
            ],
          },
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('REGENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('REGENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('REGENERATE_SECTION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/REGENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        sectionKey: 'customer_problem',
      })

    expect(res.status).toBe(200)
    const persistedSection = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.sections.customer_problem
    expect(persistedSection).toEqual(expect.objectContaining({
      input: changedInput,
      generated: expect.objectContaining({
        content: expect.stringContaining('Based on accepted Intelligence Hub evidence'),
        actionKey: 'REGENERATE_SECTION',
      }),
      accepted: null,
      state: expect.objectContaining({
        status: 'REGENERATED',
        revisionCount: 1,
      }),
      revisions: [
        expect.objectContaining({
          revisionNumber: 1,
          generated: archivedGenerated,
          accepted: expect.objectContaining({
            content: 'Accepted customer problem truth.',
          }),
          reason: 'SECTION_INPUT_CHANGED',
        }),
      ],
    }))
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      diff: expect.objectContaining({
        generation: expect.objectContaining({
          sectionKey: 'customer_problem',
          previousGenerated: true,
          regeneration: expect.objectContaining({
            reasons: ['INPUT_CHANGED'],
            previousInputHash: hashSectionInput(previousInput),
            currentInputHash: hashSectionInput(changedInput),
          }),
          revisionCount: 1,
        }),
      }),
    }))
  })

  test('rejects unchanged REGENERATE_SECTION before persistence', async () => {
    const unchangedInput = 'Proposal creation is slow.'
    const previousGenerated = {
      content: 'Customer Problem: Proposal creation is slow.',
      generatedAt: '2026-05-19T07:55:00.000Z',
      actionKey: 'GENERATE_SECTION',
      inputHash: hashSectionInput(unchangedInput),
      generator: {
        mode: 'DETERMINISTIC_TEMPLATE',
        adapter: 'runtime-section-template-v1',
        packageKey: 'vmf-standard-2-3-1',
        packageVersion: '2.3.1',
      },
    }
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
        }),
        sections: {
          customer_problem: {
            input: unchangedInput,
            generated: previousGenerated,
            review: { status: 'PENDING_REVIEW' },
            state: { status: 'GENERATED', revisionCount: 0 },
            lineage: {
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
            },
            dependencies: {
              state: 'SATISFIED',
              requiredSectionKeys: [],
              satisfiedSectionKeys: [],
              missingSectionKeys: [],
              invalidatedSectionKeys: [],
            },
            revisions: [],
          },
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('REGENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('REGENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('REGENERATE_SECTION')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/REGENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        sectionKey: 'customer_problem',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toBe(
      'Section regeneration is blocked because input, dependency, package, and style context are unchanged.',
    )
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('allows REGENERATE_SECTION when upstream accepted truth is newer than legacy dependency metadata', async () => {
    const unchangedInput = 'Reduce proposal cycle time.'
    const previousGenerated = {
      content: 'Value Drivers: Reduce proposal cycle time.',
      generatedAt: '2026-05-19T07:40:00.000Z',
      actionKey: 'GENERATE_SECTION',
      inputHash: hashSectionInput(unchangedInput),
      generator: {
        mode: 'DETERMINISTIC_TEMPLATE',
        adapter: 'runtime-section-template-v1',
        packageKey: 'vmf-standard-2-3-1',
        packageVersion: '2.3.1',
      },
    }
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
          scoped_views: {
            value_drivers: {
              source: 'DISCOVERY_EVIDENCE_PACK',
              summary: 'Accepted Intelligence Hub evidence supports value themes for proposal workflow improvement.',
              sourceRefs: ['input_targetOffer'],
            },
          },
        }),
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: {
              content: 'Customer Problem: Proposal creation is slow.',
              generatedAt: '2026-05-19T08:01:00.000Z',
              actionKey: 'GENERATE_SECTION',
              inputHash: 'hash-customer-problem',
            },
            accepted: {
              content: 'Accepted customer problem truth.',
              acceptedAt: '2026-05-19T08:05:00.000Z',
              sourceGeneratedAt: '2026-05-19T08:01:00.000Z',
              inputHash: 'hash-customer-problem',
            },
            review: { status: 'ACCEPTED' },
            state: { status: 'ACCEPTED', revisionCount: 0 },
            lineage: {
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
            },
            revisions: [],
          },
          value_drivers: {
            input: unchangedInput,
            generated: previousGenerated,
            accepted: {
              content: 'Accepted value drivers truth.',
              acceptedAt: '2026-05-19T07:45:00.000Z',
              sourceGeneratedAt: '2026-05-19T07:40:00.000Z',
              inputHash: hashSectionInput(unchangedInput),
            },
            review: { status: 'ACCEPTED' },
            state: { status: 'ACCEPTED', revisionCount: 0 },
            lineage: {
              sectionKey: 'value_drivers',
              runtimePath: 'framework_state.sections.value_drivers',
            },
            dependencies: {
              state: 'SATISFIED',
              requiredSectionKeys: ['customer_problem'],
              satisfiedSectionKeys: ['customer_problem'],
              missingSectionKeys: [],
              invalidatedSectionKeys: [],
            },
            revisions: [],
          },
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
        },
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
          dependsOnSectionKeys: ['customer_problem'],
        },
      ],
      workflowBindings: [makeWorkflowBinding('REGENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('REGENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('REGENERATE_SECTION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:06:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/REGENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        sectionKey: 'value_drivers',
      })

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      diff: expect.objectContaining({
        actionKey: 'REGENERATE_SECTION',
        generation: expect.objectContaining({
          sectionKey: 'value_drivers',
          regeneration: expect.objectContaining({
            forceRegenerateReason: '',
            invalidatedDependencySectionKeys: ['customer_problem'],
            reasons: ['DEPENDENCY_CONTEXT_INVALIDATED'],
          }),
        }),
      }),
    }))
  })

  test('allows REGENERATE_SECTION when accepted section evidence invalidated legacy generated truth without a previous section evidence hash', async () => {
    const unchangedInput = 'Value drivers need better automation proof.'
    const acceptedSectionEvidence = makeSectionEvidenceObject({
      reviewStatus: 'ACCEPTED',
      acceptedBy: CUSTOMER_ADMIN_ID,
      acceptanceTimestamp: '2026-05-19T08:03:00.000Z',
    })
    const previousGenerated = {
      content: 'Value Drivers: better automation proof.',
      generatedAt: '2026-05-19T08:01:00.000Z',
      actionKey: 'GENERATE_SECTION',
      inputHash: hashSectionInput(unchangedInput),
      generator: {
        mode: 'DETERMINISTIC_TEMPLATE',
        adapter: 'runtime-section-template-v1',
        packageKey: 'vmf-standard-2-3-1',
        packageVersion: '2.3.1',
      },
    }
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:04:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
        }),
        sections: {
          value_drivers: {
            input: unchangedInput,
            generated: previousGenerated,
            accepted: {
              content: 'Accepted value drivers truth.',
              acceptedAt: '2026-05-19T08:02:00.000Z',
              sourceGeneratedAt: '2026-05-19T08:01:00.000Z',
              inputHash: hashSectionInput(unchangedInput),
            },
            review: { status: 'ACCEPTED' },
            state: {
              status: 'ACCEPTED',
              needsRegeneration: true,
              acceptedInvalidationReason: 'SECTION_EVIDENCE_CHANGED',
              revisionCount: 0,
            },
            additionalEvidence: makeSectionAdditionalEvidence({
              evidenceObjects: [acceptedSectionEvidence],
              status: 'ACCEPTED',
            }),
            evidenceObjects: [acceptedSectionEvidence],
            intelligence: {
              invalidation: {
                reason: 'SECTION_EVIDENCE_CHANGED',
              },
            },
            lineage: {
              sectionKey: 'value_drivers',
              runtimePath: 'framework_state.sections.value_drivers',
              sectionEvidenceInvalidationReason: 'SECTION_EVIDENCE_CHANGED',
            },
            dependencies: {
              state: 'SATISFIED',
              requiredSectionKeys: [],
              satisfiedSectionKeys: [],
              missingSectionKeys: [],
              invalidatedSectionKeys: [],
            },
            revisions: [],
          },
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeSectionEvidencePackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery(makeSectionEvidenceRuntimePathRecords()))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          source: 'PACKAGE',
          isCustom: false,
          label: 'Value Drivers',
          displayOrder: 10,
          isVisible: true,
          isEditable: true,
        },
      ],
      actions: [makeUIAction('REGENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('REGENERATE_SECTION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:05:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/REGENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:04:00.000Z',
        sectionKey: 'value_drivers',
      })

    expect(res.status).toBe(200)
    const persistedSection = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.sections.value_drivers
    expect(persistedSection.state.status).toBe('REGENERATED')
    expect(persistedSection.state.needsRegeneration).toBeUndefined()
    expect(persistedSection.state.sectionEvidenceInvalidatedAt).toBeUndefined()
    expect(persistedSection.state.sectionEvidenceInvalidatedBy).toBeUndefined()
    expect(persistedSection.state.acceptedInvalidationReason).toBe('SECTION_GENERATION_REPLACED')
    expect(persistedSection.lineage.sectionEvidenceInvalidationReason).toBeUndefined()
    expect(persistedSection.intelligence.invalidation.reason).toBe('SECTION_GENERATION_REPLACED')
    expect(persistedSection.generated.sectionEvidenceHash).toEqual(expect.any(String))
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      diff: expect.objectContaining({
        generation: expect.objectContaining({
          sectionKey: 'value_drivers',
          regeneration: expect.objectContaining({
            reasons: ['SECTION_EVIDENCE_CHANGED'],
            previousSectionEvidenceHash: '',
            currentSectionEvidenceHash: expect.any(String),
          }),
        }),
      }),
    }))
  })

  test('allows forced REGENERATE_SECTION with a bounded server-recorded reason', async () => {
    const unchangedInput = 'Proposal creation is slow.'
    const previousGenerated = {
      content: 'Customer Problem: Proposal creation is slow.',
      generatedAt: '2026-05-19T07:55:00.000Z',
      actionKey: 'GENERATE_SECTION',
      inputHash: hashSectionInput(unchangedInput),
      generator: {
        mode: 'DETERMINISTIC_TEMPLATE',
        adapter: 'runtime-section-template-v1',
        packageKey: 'vmf-standard-2-3-1',
        packageVersion: '2.3.1',
      },
    }
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
        }),
        sections: {
          customer_problem: {
            input: unchangedInput,
            generated: previousGenerated,
            review: { status: 'PENDING_REVIEW' },
            state: { status: 'GENERATED', revisionCount: 0 },
            lineage: {
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
            },
            dependencies: {
              state: 'SATISFIED',
              requiredSectionKeys: [],
              satisfiedSectionKeys: [],
              missingSectionKeys: [],
              invalidatedSectionKeys: [],
            },
            revisions: [],
          },
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('REGENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('REGENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('REGENERATE_SECTION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/REGENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        sectionKey: 'customer_problem',
        forceRegenerateReason: 'Customer requested wording review.',
      })

    expect(res.status).toBe(200)
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      diff: expect.objectContaining({
        generation: expect.objectContaining({
          sectionKey: 'customer_problem',
          regeneration: expect.objectContaining({
            forceRegenerateReason: 'Customer requested wording review.',
            reasons: ['FORCED_REGENERATE_REASON'],
          }),
        }),
      }),
    }))
  })

  test('rejects REGENERATE_SECTION before generated content exists', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('REGENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('REGENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('REGENERATE_SECTION')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/REGENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        sectionKey: 'customer_problem',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects section generation without a request target', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('GENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('GENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('GENERATE_SECTION')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/GENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(422)
    expect(res.body.error.details._root).toBe('Generation actions require runtimePath or sectionKey.')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects non-generation runtime actions that include section targets', async () => {
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        runtimePath: 'framework_state.sections.customer_problem',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details._root).toBe('runtimePath and sectionKey are only allowed for generation actions.')
    expect(RuntimeInstance.findOne).not.toHaveBeenCalled()
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects force regenerate reason outside REGENERATE_SECTION', async () => {
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/GENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        sectionKey: 'customer_problem',
        forceRegenerateReason: 'Force review.',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details._root).toBe('forceRegenerateReason is only allowed for REGENERATE_SECTION.')
    expect(RuntimeInstance.findOne).not.toHaveBeenCalled()
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects section generation when sectionKey and runtimePath target different package sections', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
          value_drivers: 'Manual revenue reporting creates delay.',
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
          validationKeys: ['required-sections-check'],
        },
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
          validationKeys: ['required-sections-check'],
        },
      ],
      workflowBindings: [makeWorkflowBinding('GENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-value-drivers',
        pathKey: 'framework_state.sections.value_drivers',
        label: 'Value Drivers',
      }),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          source: 'PACKAGE',
          isCustom: false,
          label: 'Customer Problem',
          displayOrder: 10,
          isVisible: true,
          isEditable: true,
        },
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          source: 'PACKAGE',
          isCustom: false,
          label: 'Value Drivers',
          displayOrder: 20,
          isVisible: true,
          isEditable: true,
        },
      ],
      actions: [makeUIAction('GENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('GENERATE_SECTION')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/GENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        sectionKey: 'customer_problem',
        runtimePath: 'framework_state.sections.value_drivers',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details._root).toBe('runtimePath and sectionKey must target the same section.')
    expect(RuntimeInstance.findOne).not.toHaveBeenCalled()
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects non-return actions from persisted in-review state even when execution is idle', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      executionStatus: 'IDLE',
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'IN_REVIEW' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'IN_REVIEW',
          ready: true,
          submittedForReview: true,
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('MARK_READY')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('MARK_READY')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('MARK_READY')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/MARK_READY`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toContain('waiting for review')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('rejects stale runtime actions when the atomic updatedAt guard loses a write race', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('RUN_VALIDATION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('RUN_VALIDATION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('RUN_VALIDATION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn().mockResolvedValue(null)
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_STALE')
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects runtime action execution when the actor lacks VMF_UPDATE access', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    const token = await getAccessTokenForUser(makeRegularUser())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(403)
    expect(res.body.error.details.reason).toBe('FORBIDDEN')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects unsupported runtime action keys before resolving runtime state', async () => {
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/LOCK_RUNTIME`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_UNSUPPORTED')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects action execution for unsupported runtime types', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      runtimeType: 'DEAL_ANALYSIS',
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_UNSUPPORTED_RUNTIME_TYPE')
    expect(res.body.error.details.supportedRuntimeTypes).toEqual(['VALUE_NARRATIVE'])
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects runtime actions that are not declared by the renderer projection', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('RUN_VALIDATION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('RUN_VALIDATION')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_DECLARED')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects runtime actions when the runtime instance is inactive', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      status: 'ARCHIVED',
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('RUN_VALIDATION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('RUN_VALIDATION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('RUN_VALIDATION')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toContain('active runtime instance')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('rejects runtime actions when execution is terminal', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      executionStatus: 'COMPLETE',
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('RUN_VALIDATION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('RUN_VALIDATION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('RUN_VALIDATION')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toContain('blocked while execution is in progress or terminal')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('rejects renderer-projected action denial from workflow policy decision mode', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('RUN_VALIDATION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('RUN_VALIDATION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([
      makeActionWorkflowPolicy('RUN_VALIDATION', { decisionMode: 'DENY' }),
    ]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toBe('Workflow policy decision mode is not executable by the renderer.')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('rolls back a non-transactional runtime action when audit persistence fails', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedBy: CUSTOMER_ADMIN_ID,
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('RUN_VALIDATION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('RUN_VALIDATION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('RUN_VALIDATION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn()
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        framework_state: {
          ...runtimeInstanceDoc.framework_state,
          readiness: { state: 'VALIDATED' },
        },
        updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      }))
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        updatedAt: new Date('2026-05-19T08:02:00.000Z'),
      }))
    AuditLog.createLog = jest.fn(async () => {
      throw new Error('audit unavailable')
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('RUNTIME_ACTION_AUDIT_FAILED')
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_AUDIT_PERSISTENCE_FAILED')
    expect(res.body.error.details.auditError).toEqual(expect.objectContaining({
      name: 'Error',
      message: 'audit unavailable',
    }))
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(RuntimeInstance.findOneAndUpdate.mock.calls[1]).toEqual([
      {
        _id: RUNTIME_INSTANCE_ID,
        updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      },
      {
        $set: {
          framework_state: runtimeInstanceDoc.framework_state,
          executionStatus: runtimeInstanceDoc.executionStatus,
          status: runtimeInstanceDoc.status,
          lockedAt: null,
          lockedBy: null,
          lockedReason: '',
          updatedBy: CUSTOMER_ADMIN_ID,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ])
  })

  test('records a system event when runtime action rollback fails after audit persistence failure', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedBy: CUSTOMER_ADMIN_ID,
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('RUN_VALIDATION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('RUN_VALIDATION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('RUN_VALIDATION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn()
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        framework_state: {
          ...runtimeInstanceDoc.framework_state,
          readiness: { state: 'VALIDATED' },
        },
        updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      }))
      .mockResolvedValueOnce(null)
    AuditLog.createLog = jest.fn()
      .mockRejectedValueOnce(new Error('audit unavailable'))
      .mockResolvedValueOnce({})
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('RUNTIME_ACTION_AUDIT_FAILED')
    expect(res.body.error.details.rollbackFailed).toBe(true)
    expect(AuditLog.createLog).toHaveBeenCalledTimes(2)
    expect(AuditLog.createLog.mock.calls[1][0]).toEqual(expect.objectContaining({
      action: 'RUNTIME_ACTION_EXECUTED',
      isSystemEvent: true,
      systemEventType: 'RUNTIME_ACTION_ROLLBACK_FAILED',
      eventSeverity: 'CRITICAL',
      diff: expect.objectContaining({
        reason: 'RUNTIME_ACTION_AUDIT_PERSISTENCE_FAILED',
        auditError: expect.objectContaining({
          message: 'Runtime action audit could not be persisted.',
        }),
      }),
    }))
  })

  test('rolls back LOCK_RECORD fields when audit persistence fails', async () => {
    const publishedFrameworkState = {
      lifecycle: {
        stage: 'PUBLISHED',
        publishedAt: '2026-05-19T08:00:00.000Z',
        publishedBy: CUSTOMER_ADMIN_ID,
      },
      sections: {
        customer_problem: {
          input: 'Proposal creation is slow.',
          generated: {
            content: 'Customer Problem: Proposal creation is slow.',
            generatedAt: '2026-05-19T07:58:00.000Z',
          },
          accepted: {
            content: 'Customer Problem: Proposal creation is slow.',
            acceptedAt: '2026-05-19T07:59:00.000Z',
            acceptedBy: CUSTOMER_ADMIN_ID,
            sourceGeneratedAt: '2026-05-19T07:58:00.000Z',
          },
          review: { status: 'ACCEPTED' },
          state: { status: 'ACCEPTED' },
        },
      },
      validation: {
        runtime_required_sections: {
          is_valid: true,
          status: 'PASSED',
        },
      },
      readiness: {
        state: 'PUBLISHED',
        approved: true,
        published: true,
        ready: true,
        validationState: 'PASSED',
      },
      publish: {
        state: 'PUBLISHED',
        published: true,
        publishedAt: '2026-05-19T08:00:00.000Z',
        publishedBy: CUSTOMER_ADMIN_ID,
        publishVersion: 1,
        outputEligible: true,
        sourceApproval: {
          approvedAt: '2026-05-19T07:55:00.000Z',
          approvedBy: CUSTOMER_ADMIN_ID,
        },
        evidence: {
          activationId: 'activation-vmf-2-3-1-001',
          deploymentId: 'deployment-vmf-global-production-001',
          dependencySnapshotId: 'dep-lock-vmf-standard-2-3-1',
          dependencySnapshotHash: 'hash-vmf-standard-2-3-1',
        },
        snapshot: {
          snapshotId: 'runtime-truth-publish-value-narrative-439111-existing',
          snapshotHash: 'existing-publish-snapshot-hash',
          snapshotAt: '2026-05-19T08:00:00.000Z',
          contractVersion: 'runtime-truth-snapshot-v1',
        },
        outputEligibility: {
          state: 'PUBLISH_ELIGIBLE',
          outputEligible: true,
          canonicalOutputEligible: false,
        },
      },
      lock: {},
      policy: {},
      attachments: {},
      artifacts: {},
    }
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedBy: CUSTOMER_ADMIN_ID,
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: publishedFrameworkState,
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('LOCK_RECORD')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('LOCK_RECORD')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('LOCK_RECORD')]))
    RuntimeInstance.findOneAndUpdate = jest.fn()
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        status: 'LOCKED',
        executionStatus: 'COMPLETE',
        lockedAt: new Date('2026-05-19T08:01:00.000Z'),
        lockedBy: CUSTOMER_ADMIN_ID,
        lockedReason: 'Runtime published truth locked for downstream canonical use.',
        framework_state: {
          ...publishedFrameworkState,
          lifecycle: { stage: 'LOCKED' },
          lock: { state: 'LOCKED', locked: true },
        },
        updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      }))
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        updatedAt: new Date('2026-05-19T08:02:00.000Z'),
      }))
    AuditLog.createLog = jest.fn(async () => {
      throw new Error('audit unavailable')
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/LOCK_RECORD`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('RUNTIME_ACTION_AUDIT_FAILED')
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(RuntimeInstance.findOneAndUpdate.mock.calls[1]).toEqual([
      {
        _id: RUNTIME_INSTANCE_ID,
        updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      },
      {
        $set: {
          framework_state: publishedFrameworkState,
          executionStatus: 'IDLE',
          status: 'ACTIVE',
          lockedAt: null,
          lockedBy: null,
          lockedReason: '',
          updatedBy: CUSTOMER_ADMIN_ID,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ])
  })

  test('renders a runtime workspace from package sections, runtime paths, UI Contract, workflow policy, and framework_state', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(FrameworkPackage.findById).toHaveBeenCalledWith(FRAMEWORK_PACKAGE_ID)
    expect(UIContract.findOne).toHaveBeenCalledWith({
      uiContractKey: UI_CONTRACT_KEY,
      status: 'ACTIVE',
      frameworkKeys: 'VMF',
    })
    expect(RuntimePathRegistry.find).toHaveBeenCalledWith({
      pathKey: { $in: ['framework_state.sections.customer_problem'] },
      status: 'ACTIVE',
      frameworkKeys: 'VMF',
    })
    expect(WorkflowPolicy.find).toHaveBeenCalledWith({
      key: { $in: ['submit-for-review-policy'] },
      status: 'ACTIVE',
      frameworkKeys: 'VMF',
    })
    expect(res.body.data).toEqual(expect.objectContaining({
      rendererContractVersion: 'runtime-renderer.v1.read-projection',
      runtimeInstanceKey: 'value-narrative-439111',
      projectionGeneratedAt: expect.any(String),
    }))
    expect(Number.isNaN(Date.parse(res.body.data.projectionGeneratedAt))).toBe(false)
    expect(res.body.data.workspace).toEqual(expect.objectContaining({
      workspaceId: RUNTIME_INSTANCE_ID,
      workspaceKey: 'value-narrative-439111',
      routeKey: RUNTIME_INSTANCE_ID,
    }))
    expect(res.body.data.sections).toEqual([
      expect.objectContaining({
        key: 'customer_problem',
        runtimePath: 'framework_state.sections.customer_problem',
        label: 'Customer Problem',
        control: 'TEXTAREA',
        required: true,
        helpText: 'Describe the core problem.',
        placeholder: 'Example: Proposal creation is slow.',
        value: 'Proposal creation is slow.',
        validationKeys: ['required-sections-check'],
        editable: true,
        generationEligibility: expect.objectContaining({
          canGenerate: false,
          reason: 'Accept Intelligence Hub evidence before generating this section.',
          sources: ['SECTION_CONTEXT'],
        }),
      }),
    ])
    expect(res.body.data.discovery).toEqual({
      state: {
        status: 'EVIDENCE_NOT_READY',
      },
      inputComplete: false,
      evidenceReady: false,
      accepted: false,
      needsRefresh: false,
      acquisitionProfile: 'STANDARD',
      acquisition: {},
      sourceRegistrySummary: {
        count: 0,
        sourceTypes: [],
      },
      evidenceObjectSummary: {
        evidenceObjectCount: 0,
        acceptedEvidenceCount: 0,
        pendingReviewCount: 0,
        rejectedEvidenceCount: 0,
      },
      discoveryHealth: {},
      scopedViews: {},
      inputSummary: {
        keys: [],
        count: 0,
      },
      evidenceSummary: {
        keys: [],
        count: 0,
      },
      summarySummary: {
        keys: [],
        count: 0,
      },
      scopedViewSummary: {
        keys: [],
        count: 0,
      },
      lineageSummary: {
        sourceCount: 0,
        builderMode: '',
      },
      inputValues: {},
    })
    expect(res.body.data.actions).toEqual([
      expect.objectContaining({
        actionKey: 'SUBMIT_FOR_REVIEW',
        buttonLabel: 'Submit for Review',
        enabled: false,
        disabledReason: 'Mark this runtime ready after successful validation before submitting for review.',
        requiresConfirmation: true,
        confirmationMessage: 'Submit this framework for review?',
        policyKey: 'submit-for-review-policy',
      }),
    ])
    expect(res.body.data.validation).toEqual(expect.objectContaining({
      state: 'UNKNOWN',
      messages: [],
    }))
    expect(res.body.data.readiness).toEqual(expect.objectContaining({
      state: 'DRAFT',
      ready: false,
      submittedForReview: false,
    }))
    expect(res.body.data.signals).toEqual([])
    expect(res.body.data.activity).toEqual([])
    expect(res.body.data.runtimeInstance.framework_state).toBeUndefined()
    expect(res.body.data.frameworkState).toBeUndefined()
    expect(res.body.data.runtimeData).toEqual({
      readablePaths: [],
    })
    expect(res.body.data.diagnostics.runtimePathVisibility).toBe('HIDDEN')
    expect(res.body.data.diagnostics.configWarnings).toEqual([])
    expect(res.body.meta.renderTraceId).toMatch(/^render-/)
  })

  test('projects runtime activity from persisted audit rows without exposing raw audit payloads', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    const auditFindChain = buildAuditLogFindChain([
      {
        _id: '64f000000000000000000001',
        ts: '2026-05-19T08:05:00.000Z',
        action: 'RUNTIME_STATE_MUTATED',
        resourceType: 'RuntimeInstance',
        resourceId: RUNTIME_INSTANCE_ID,
        summary: `Jill Faithful updated runtime state for RuntimeInstance ${RUNTIME_INSTANCE_ID}`,
        display: {
          actorLabel: 'Jill Faithful',
        },
        diff: {
          reason: 'DISCOVERY_RESET',
          resetReason: 'USER_REQUESTED_DISCOVERY_RESET',
          resetAt: '2026-05-19T08:05:00.000Z',
          resetByLabel: 'Jill Faithful',
          previousEvidenceSummary: {
            accepted: true,
            stateStatus: 'ACCEPTED',
            inputCount: 6,
            sourceRegistryCount: 10,
            evidenceObjectCount: 10,
            scopedViewCount: 25,
          },
          nextEvidenceSummary: {
            accepted: false,
            stateStatus: 'RESET',
            inputCount: 0,
            sourceRegistryCount: 0,
            evidenceObjectCount: 0,
            scopedViewCount: 0,
          },
          previousValue: {
            sourceRegistry: ['raw source payload must not project'],
          },
          clearedSectionTruthCount: 1,
          clearedSectionTruths: [
            {
              sectionKey: 'customer_problem',
              hadGenerated: true,
              hadAccepted: true,
            },
          ],
        },
      },
      {
        _id: '64f000000000000000000002',
        ts: '2026-05-19T08:04:00.000Z',
        action: 'RUNTIME_STATE_MUTATED',
        resourceType: 'RuntimeInstance',
        resourceId: RUNTIME_INSTANCE_ID,
        summary: 'Customer Problem saved.',
        display: {
          actorLabel: 'Jill Faithful',
        },
        scope: {
          customerId: CUSTOMER_ID,
          runtimeInstanceId: RUNTIME_INSTANCE_ID,
        },
        diff: {
          after: {
            'framework_state.sections.customer_problem.input': 'Proposal creation is slow.',
          },
        },
      },
      {
        _id: '64f000000000000000000003',
        ts: '2026-05-19T08:03:00.000Z',
        action: 'RUNTIME_ACTION_EXECUTED',
        resourceType: 'RuntimeInstance',
        resourceId: RUNTIME_INSTANCE_ID,
        display: {
          title: 'Validation ran',
        },
      },
      {
        _id: '64f000000000000000000004',
        ts: '2026-05-19T08:02:00.000Z',
        action: 'RUNTIME_ACTION_EXECUTED',
        resourceType: 'RuntimeInstance',
        resourceId: RUNTIME_INSTANCE_ID,
        diff: {
          actionKey: 'RUN_VALIDATION',
          governedAction: 'RUN_VALIDATION',
        },
      },
    ])
    AuditLog.find = jest.fn().mockReturnValue(auditFindChain)
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(AuditLog.find).toHaveBeenCalledWith({
      resourceType: 'RuntimeInstance',
      resourceId: RUNTIME_INSTANCE_ID,
    })
    expect(auditFindChain.sort).toHaveBeenCalledWith({ ts: -1 })
    expect(auditFindChain.limit).toHaveBeenCalledWith(10)
    expect(res.body.data.signals).toEqual([])
    expect(res.body.data.activity).toEqual([
      {
        eventId: '64f000000000000000000001',
        action: 'RUNTIME_STATE_MUTATED',
        summary: 'cleared Intelligence Hub evidence and section truth',
        occurredAt: '2026-05-19T08:05:00.000Z',
        actorLabel: 'Jill Faithful',
        activityType: 'DISCOVERY_RESET',
        reset: {
          reason: 'DISCOVERY_RESET',
          resetReason: 'USER_REQUESTED_DISCOVERY_RESET',
          resetAt: '2026-05-19T08:05:00.000Z',
          resetByLabel: 'Jill Faithful',
          previousEvidenceSummary: {
            accepted: true,
            stateStatus: 'ACCEPTED',
            inputCount: 6,
            sourceCount: 0,
            sourceRegistryCount: 10,
            evidenceObjectCount: 10,
            scopedViewCount: 25,
            acceptedAt: '',
            acquisitionProfile: '',
          },
          nextEvidenceSummary: {
            accepted: false,
            stateStatus: 'RESET',
            inputCount: 0,
            sourceCount: 0,
            sourceRegistryCount: 0,
            evidenceObjectCount: 0,
            scopedViewCount: 0,
            acceptedAt: '',
            acquisitionProfile: '',
          },
          clearedSectionTruthCount: 1,
        },
      },
      {
        eventId: '64f000000000000000000002',
        action: 'RUNTIME_STATE_MUTATED',
        summary: 'Customer Problem saved.',
        occurredAt: '2026-05-19T08:04:00.000Z',
        actorLabel: 'Jill Faithful',
      },
      {
        eventId: '64f000000000000000000003',
        action: 'RUNTIME_ACTION_EXECUTED',
        summary: 'Validation ran',
        occurredAt: '2026-05-19T08:03:00.000Z',
      },
      {
        eventId: '64f000000000000000000004',
        action: 'RUNTIME_ACTION_EXECUTED',
        actionKey: 'RUN_VALIDATION',
        governedAction: 'RUN_VALIDATION',
        summary: 'Run Validation executed',
        occurredAt: '2026-05-19T08:02:00.000Z',
      },
    ])
    expect(res.body.data.activity[0].diff).toBeUndefined()
    expect(res.body.data.activity[0].reset.previousValue).toBeUndefined()
    expect(res.body.data.activity[0].reset.clearedSectionTruths).toBeUndefined()
    expect(res.body.data.activity[0].reset.resetBy).toBeUndefined()
    expect(JSON.stringify(res.body.data.activity[0])).not.toContain(CUSTOMER_ADMIN_ID)
    expect(res.body.data.activity[0].scope).toBeUndefined()
    expect(res.body.data.activity[0].resourceId).toBeUndefined()
    expect(res.body.data.activity[0].summary).not.toContain(RUNTIME_INSTANCE_ID)
  })

  test('projects accepted section truth from framework_state without deriving it from generated content', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: {
              content: 'Generated but not final.',
              generatedAt: '2026-05-19T08:01:00.000Z',
              inputHash: 'hash-1',
            },
            accepted: {
              content: 'Accepted customer problem truth.',
              truthHash: 'sha256:accepted-customer-problem-truth',
              acceptedAt: '2026-05-19T08:02:00.000Z',
              acceptedBy: CUSTOMER_ADMIN_ID,
              sourceGeneratedAt: '2026-05-19T08:01:00.000Z',
              inputHash: 'hash-1',
              revisions: [
                {
                  revisionNumber: 1,
                  replacedAt: '2026-05-19T08:02:00.000Z',
                  reason: 'ACCEPTED_TRUTH_REPLACED',
                  accepted: {
                    content: 'Earlier accepted truth.',
                    truthHash: 'sha256:earlier-truth',
                  },
                },
              ],
            },
            review: {
              status: 'ACCEPTED',
            },
            state: {
              status: 'ACCEPTED',
            },
            lineage: {},
            revisions: [],
          },
        },
      },
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.sections[0].generated).toEqual(expect.objectContaining({
      content: 'Generated but not final.',
    }))
    expect(res.body.data.sections[0].accepted).toEqual(expect.objectContaining({
      content: 'Accepted customer problem truth.',
      truthHash: 'sha256:accepted-customer-problem-truth',
      acceptedBy: CUSTOMER_ADMIN_ID,
      sourceGeneratedAt: '2026-05-19T08:01:00.000Z',
    }))
    expect(res.body.data.sections[0].acceptedRevisions).toEqual([
      expect.objectContaining({
        revisionNumber: 1,
        reason: 'ACCEPTED_TRUTH_REPLACED',
        accepted: expect.objectContaining({
          content: 'Earlier accepted truth.',
          truthHash: 'sha256:earlier-truth',
        }),
      }),
    ])
  })

  test('projects section evidence metadata with bounded snippets without exposing uploaded content', async () => {
    const acceptedEvidenceObject = makeSectionEvidenceObject({
      reviewStatus: 'ACCEPTED',
      acceptedBy: CUSTOMER_ADMIN_ID,
      acceptanceTimestamp: '2026-05-19T08:03:00.000Z',
      extractedFact: 'Document Section Supporting File: Customer margin workflow reduces manual proposal effort for enterprise account teams while preserving governed evidence alignment across regional sales leadership, partner delivery teams, and executive review cycles.',
      contentBase64: 'ZG8tbm90LXByb2plY3Q=',
      rawText: 'do not project raw text',
    })
    FrameworkPackage.findById.mockResolvedValue(makeSectionEvidencePackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery(makeSectionEvidenceRuntimePathRecords()))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeSectionEvidenceUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: {
            input: 'Proposal teams need faster governed narrative creation.',
            generated: {
              content: 'Customer Problem: proposal teams need faster governed narrative creation.',
              generatedAt: '2026-05-19T08:01:00.000Z',
            },
            accepted: {
              content: 'Customer Problem: proposal teams need faster governed narrative creation.',
              acceptedAt: '2026-05-19T08:02:00.000Z',
              acceptedBy: CUSTOMER_ADMIN_ID,
              sourceGeneratedAt: '2026-05-19T08:01:00.000Z',
            },
            review: { status: 'ACCEPTED' },
            state: { status: 'ACCEPTED' },
          },
          value_drivers: {
            input: 'Initial value driver context.',
            generated: {
              content: 'Value Drivers: faster proposal workflows.',
              generatedAt: '2026-05-19T08:01:00.000Z',
              inputHash: 'hash-input',
            },
            accepted: {
              content: 'Value Drivers: faster proposal workflows.',
              acceptedAt: '2026-05-19T08:02:00.000Z',
              acceptedBy: CUSTOMER_ADMIN_ID,
              sourceGeneratedAt: '2026-05-19T08:01:00.000Z',
              inputHash: 'hash-input',
            },
            review: { status: 'ACCEPTED' },
            state: {
              status: 'ACCEPTED',
              needsRegeneration: true,
              acceptedInvalidationReason: 'SECTION_EVIDENCE_CHANGED',
            },
            additionalEvidence: makeSectionAdditionalEvidence({
              documents: [
                {
                  sectionDocumentId: 'section_document_value_fixture',
                  sourceId: 'section_document_value_fixture',
                  fileName: 'value-notes.md',
                  fileType: 'TXT',
                  mimeType: 'text/markdown',
                  sizeBytes: 92,
                  uploadedAt: '2026-05-19T08:02:00.000Z',
                  uploadedBy: CUSTOMER_ADMIN_ID,
                  status: 'PROCESSED',
                  ingestionMode: 'TEXT_NATIVE',
                  evidenceObjectsGenerated: 1,
                  contentBase64: 'ZG8tbm90LXByb2plY3Q=',
                  textContent: 'do not project uploaded text',
                },
              ],
              evidenceObjects: [acceptedEvidenceObject],
              status: 'ACCEPTED',
            }),
            evidenceObjects: [acceptedEvidenceObject],
          },
        },
        validation: {},
      },
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const valueDrivers = res.body.data.sections.find((section) => section.sectionKey === 'value_drivers')
    expect(valueDrivers.sectionEvidence).toEqual(expect.objectContaining({
      status: 'ACCEPTED',
      documentCount: 1,
      evidenceObjectCount: 1,
      acceptedEvidenceObjectCount: 1,
      pendingEvidenceObjectCount: 0,
      rejectedEvidenceObjectCount: 0,
      documents: [
        expect.objectContaining({
          fileName: 'value-notes.md',
          sectionDocumentId: 'section_document_value_fixture',
          status: 'PROCESSED',
          ingestionMode: 'TEXT_NATIVE',
        }),
      ],
      evidenceObjects: [
        expect.objectContaining({
          evidenceObjectId: 'section_evidence_value_fixture',
          reviewStatus: 'ACCEPTED',
          sourceType: 'SECTION_UPLOADED_DOCUMENT',
          sourceFileName: 'value-notes.md',
          snippet: expect.stringMatching(/^Customer margin workflow reduces manual proposal effort/),
        }),
      ],
    }))
    expect(valueDrivers.sectionEvidence.evidenceObjects[0].snippet.length).toBeLessThanOrEqual(120)
    expect(valueDrivers.sectionEvidence.evidenceObjects[0].snippet).toMatch(/\.\.\.$/)
    expect(valueDrivers.readiness).toEqual({
      state: 'REGENERATION_REQUIRED',
      publishEligible: false,
      reason: 'Accepted section evidence changed. Regenerate this section before accepting or publishing truth.',
      blockingValidationCount: 0,
    })
    expect(res.body.data.readiness.sectionTruth).toEqual(expect.objectContaining({
      state: 'SECTION_TRUTH_BLOCKED',
      publishEligible: false,
      lockEligible: false,
      requiredSectionCount: 2,
      readySectionCount: 1,
      blockingSectionCount: 1,
      reason: 'Accepted section evidence changed. Regenerate this section before accepting or publishing truth.',
      blockers: [
        expect.objectContaining({
          sectionKey: 'value_drivers',
          state: 'SECTION_EVIDENCE_CHANGED',
          reason: 'Accepted section evidence changed. Regenerate this section before accepting or publishing truth.',
        }),
      ],
    }))
    expect(res.body.data.publish.sectionTruthReady).toBe(false)
    expect(res.body.data.lock.sectionTruthReady).toBe(false)
    expect(JSON.stringify(valueDrivers.sectionEvidence)).toContain('Customer margin workflow reduces manual proposal effort')
    expect(JSON.stringify(valueDrivers.sectionEvidence)).not.toContain('Document Section Supporting File:')
    expect(JSON.stringify(valueDrivers.sectionEvidence)).not.toContain('contentBase64')
    expect(JSON.stringify(valueDrivers.sectionEvidence)).not.toContain('textContent')
    expect(JSON.stringify(valueDrivers.sectionEvidence)).not.toContain('do not project')
  })

  test('projects governed section intelligence from accepted truth, discovery, dependencies, and validation', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
          },
          scoped_views: {
            customer_problem: {
              summary: 'Proposal teams need a shared governed narrative.',
              sourceRefs: ['input_companyWebsite'],
            },
          },
        }),
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: {
              content: 'Customer Problem: Proposal creation is slow.',
              generatedAt: '2026-05-19T08:01:00.000Z',
              generator: {
                mode: 'DETERMINISTIC_TEMPLATE',
              },
            },
            accepted: {
              content: 'Customer Problem: Proposal creation is slow.',
              acceptedAt: '2026-05-19T08:02:00.000Z',
              acceptedBy: CUSTOMER_ADMIN_ID,
              sourceGeneratedAt: '2026-05-19T08:01:00.000Z',
            },
            review: {
              status: 'ACCEPTED',
            },
            state: {
              status: 'ACCEPTED',
            },
            lineage: {},
            revisions: [],
          },
        },
        validation: {},
      },
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.sections[0].intelligence).toEqual(expect.objectContaining({
      ownershipZones: expect.objectContaining({
        suggestedFromDiscovery: {
          available: true,
          source: 'DISCOVERY_EVIDENCE_PACK',
        },
        additionalContext: {
          available: true,
        },
        generatedSection: expect.objectContaining({
          available: true,
          generatedAt: '2026-05-19T08:01:00.000Z',
          generatorMode: 'DETERMINISTIC_TEMPLATE',
        }),
        acceptedTruth: expect.objectContaining({
          available: true,
          current: true,
          acceptedAt: '2026-05-19T08:02:00.000Z',
        }),
      }),
      confidence: {
        level: 'HIGH',
        score: 90,
        reasons: [
          'DISCOVERY_SCOPED_EVIDENCE',
          'ADDITIONAL_CONTEXT',
          'GENERATED_CONTENT',
          'ACCEPTED_TRUTH_CURRENT',
        ],
      },
      dependency: {
        state: 'NO_SECTION_DEPENDENCIES',
        requiredSectionKeys: [],
        satisfiedSectionKeys: [],
        missingSectionKeys: [],
        acceptedSectionKeys: [],
        missingAcceptedTruthSectionKeys: [],
        invalidatedSectionKeys: [],
        dependencyInvalidationRecords: [],
        lastInvalidatedAt: '',
        invalidatedBySectionKey: '',
        invalidatedByRuntimePath: '',
      },
      compare: expect.objectContaining({
        state: 'GENERATED_MATCHES_ACCEPTED_TRUTH',
        currentGeneratedAccepted: true,
        hasGenerated: true,
        hasAccepted: true,
      }),
      readiness: {
        state: 'ACCEPTED_TRUTH_READY',
        publishEligible: true,
        reason: '',
        blockingValidationCount: 0,
      },
      generationControls: {
        tokenProfile: 'SECTION_SCOPED_BOUNDED',
        fullVmfSynthesisAllowed: false,
        runtimeOutputExpansionAllowed: false,
      },
    }))
    expect(res.body.data.sections[0].confidence).toEqual(res.body.data.sections[0].intelligence.confidence)
    expect(res.body.data.sections[0].signals).toBeUndefined()
  })

  test('marks generated and accepted truth stale when section input changed after generation', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: {
            input: 'Proposal creation became slow after a pricing change.',
            generated: {
              content: 'Customer Problem: Proposal creation is slow.',
              generatedAt: '2026-05-19T08:01:00.000Z',
              inputHash: 'hash-before-input-change',
            },
            accepted: {
              content: 'Customer Problem: Proposal creation is slow.',
              acceptedAt: '2026-05-19T08:02:00.000Z',
              acceptedBy: CUSTOMER_ADMIN_ID,
              sourceGeneratedAt: '2026-05-19T08:01:00.000Z',
              inputHash: 'hash-before-input-change',
            },
            review: {
              status: 'ACCEPTED',
            },
            state: {
              status: 'ACCEPTED',
            },
            lineage: {},
            revisions: [],
          },
        },
        validation: {},
      },
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.sections[0].compare).toEqual(expect.objectContaining({
      state: 'GENERATED_STALE_AGAINST_INPUT',
      currentGeneratedAccepted: false,
      generatedStaleAgainstInput: true,
      hasGenerated: true,
      hasAccepted: true,
    }))
    expect(res.body.data.sections[0].readiness).toEqual({
      state: 'REGENERATION_REQUIRED',
      publishEligible: false,
      reason: 'Section input changed after generation. Regenerate before accepting or publishing truth.',
      blockingValidationCount: 0,
    })
    expect(res.body.data.sections[0].confidence).toEqual(expect.objectContaining({
      level: 'LOW',
      reasons: expect.arrayContaining([
        'ADDITIONAL_CONTEXT',
        'GENERATED_CONTENT',
        'GENERATED_STALE_AGAINST_INPUT',
        'ACCEPTED_TRUTH_PRESENT',
      ]),
    }))
  })

  test('marks downstream section truth stale when upstream accepted truth changed after generation', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
          validationKeys: ['required-sections-check'],
        },
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
          validationKeys: ['required-sections-check'],
          dependsOnSectionKeys: ['customer_problem'],
        },
      ],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-value-drivers',
        pathKey: 'framework_state.sections.value_drivers',
        label: 'Value Drivers',
      }),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        makeUIContract().sections[0],
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          source: 'PACKAGE',
          isCustom: false,
          label: 'Value Drivers',
          displayOrder: 20,
          isVisible: true,
          isEditable: true,
        },
      ],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: {
              content: 'Customer Problem: Proposal creation is slow.',
              generatedAt: '2026-05-19T08:04:00.000Z',
            },
            accepted: {
              content: 'Customer Problem: Proposal creation is slow.',
              acceptedAt: '2026-05-19T08:05:00.000Z',
              acceptedBy: CUSTOMER_ADMIN_ID,
              sourceGeneratedAt: '2026-05-19T08:04:00.000Z',
            },
            review: {
              status: 'ACCEPTED',
            },
            state: {
              status: 'ACCEPTED',
            },
          },
          value_drivers: {
            input: 'Reduce proposal effort and improve narrative consistency.',
            generated: {
              content: 'Value Drivers: Reduce proposal effort and improve narrative consistency.',
              generatedAt: '2026-05-19T08:01:00.000Z',
            },
            accepted: {
              content: 'Value Drivers: Reduce proposal effort and improve narrative consistency.',
              acceptedAt: '2026-05-19T08:02:00.000Z',
              acceptedBy: CUSTOMER_ADMIN_ID,
              sourceGeneratedAt: '2026-05-19T08:01:00.000Z',
            },
            review: {
              status: 'ACCEPTED',
            },
            state: {
              status: 'ACCEPTED',
            },
            dependencies: {
              state: 'DEPENDENCY_CONTEXT_INVALIDATED',
              invalidatedAt: '2026-05-19T08:05:00.000Z',
              invalidatedBySectionKey: 'customer_problem',
              invalidatedByRuntimePath: 'framework_state.sections.customer_problem',
              invalidatedSectionKeys: ['customer_problem'],
              invalidations: [
                {
                  sectionKey: 'value_drivers',
                  runtimePath: 'framework_state.sections.value_drivers',
                  invalidatedBySectionKey: 'customer_problem',
                  invalidatedByRuntimePath: 'framework_state.sections.customer_problem',
                  upstreamAcceptedAt: '2026-05-19T08:05:00.000Z',
                  invalidatedAt: '2026-05-19T08:05:00.000Z',
                  invalidatedBy: CUSTOMER_ADMIN_ID,
                  reason: 'UPSTREAM_ACCEPTED_TRUTH_CHANGED',
                },
              ],
            },
          },
        },
        validation: {},
      },
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const valueDrivers = res.body.data.sections.find((section) => section.sectionKey === 'value_drivers')
    expect(valueDrivers.dependency).toEqual({
      state: 'DEPENDENCY_CONTEXT_INVALIDATED',
      requiredSectionKeys: ['customer_problem'],
      satisfiedSectionKeys: ['customer_problem'],
      missingSectionKeys: [],
      acceptedSectionKeys: ['customer_problem'],
      missingAcceptedTruthSectionKeys: [],
      invalidatedSectionKeys: ['customer_problem'],
      dependencyInvalidationRecords: [
        expect.objectContaining({
          sectionKey: 'value_drivers',
          invalidatedBySectionKey: 'customer_problem',
          reason: 'UPSTREAM_ACCEPTED_TRUTH_CHANGED',
        }),
      ],
      lastInvalidatedAt: '2026-05-19T08:05:00.000Z',
      invalidatedBySectionKey: 'customer_problem',
      invalidatedByRuntimePath: 'framework_state.sections.customer_problem',
    })
    expect(valueDrivers.compare).toEqual(expect.objectContaining({
      state: 'GENERATED_MATCHES_ACCEPTED_TRUTH',
      currentGeneratedAccepted: true,
    }))
    expect(valueDrivers.readiness).toEqual({
      state: 'REGENERATION_REQUIRED',
      publishEligible: false,
      reason: 'Accepted upstream section truth changed. Regenerate this section before publish or lock.',
      blockingValidationCount: 0,
    })
    expect(valueDrivers.confidence).toEqual(expect.objectContaining({
      level: 'LOW',
      reasons: expect.arrayContaining([
        'ADDITIONAL_CONTEXT',
        'GENERATED_CONTENT',
        'ACCEPTED_TRUTH_CURRENT',
        'DEPENDENCY_CONTEXT_INVALIDATED',
      ]),
    }))
  })

  test('blocks downstream publish readiness when upstream accepted truth is missing', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
          validationKeys: ['required-sections-check'],
        },
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
          validationKeys: ['required-sections-check'],
          dependsOnSectionKeys: ['customer_problem'],
        },
      ],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-value-drivers',
        pathKey: 'framework_state.sections.value_drivers',
        label: 'Value Drivers',
      }),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        makeUIContract().sections[0],
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          source: 'PACKAGE',
          isCustom: false,
          label: 'Value Drivers',
          displayOrder: 20,
          isVisible: true,
          isEditable: true,
        },
      ],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: {
              content: 'Customer Problem: Proposal creation is slow.',
              generatedAt: '2026-05-19T08:01:00.000Z',
            },
            review: {
              status: 'PENDING_REVIEW',
            },
            state: {
              status: 'GENERATED',
            },
          },
          value_drivers: {
            input: 'Reduce proposal effort and improve narrative consistency.',
            generated: {
              content: 'Value Drivers: Reduce proposal effort and improve narrative consistency.',
              generatedAt: '2026-05-19T08:02:00.000Z',
            },
            accepted: {
              content: 'Value Drivers: Reduce proposal effort and improve narrative consistency.',
              acceptedAt: '2026-05-19T08:03:00.000Z',
              acceptedBy: CUSTOMER_ADMIN_ID,
              sourceGeneratedAt: '2026-05-19T08:02:00.000Z',
            },
            review: {
              status: 'ACCEPTED',
            },
            state: {
              status: 'ACCEPTED',
            },
          },
        },
        validation: {},
      },
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const valueDrivers = res.body.data.sections.find((section) => section.sectionKey === 'value_drivers')
    expect(valueDrivers.dependency).toEqual({
      state: 'MISSING_ACCEPTED_TRUTH',
      requiredSectionKeys: ['customer_problem'],
      satisfiedSectionKeys: ['customer_problem'],
      missingSectionKeys: [],
      acceptedSectionKeys: [],
      missingAcceptedTruthSectionKeys: ['customer_problem'],
      invalidatedSectionKeys: [],
      dependencyInvalidationRecords: [],
      lastInvalidatedAt: '',
      invalidatedBySectionKey: '',
      invalidatedByRuntimePath: '',
    })
    expect(valueDrivers.readiness).toEqual({
      state: 'DEPENDENCY_ACCEPTED_TRUTH_MISSING',
      publishEligible: false,
      reason: 'Required upstream accepted truth is missing.',
      blockingValidationCount: 0,
    })
    expect(valueDrivers.confidence).toEqual(expect.objectContaining({
      reasons: expect.arrayContaining([
        'DEPENDENCY_ACCEPTED_TRUTH_MISSING',
      ]),
    }))
  })

  test('projects real discovery evidence pack state without fabricating evidence content', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: {
          state: {
            status: 'ACCEPTED',
          },
          inputComplete: true,
          evidenceReady: true,
          accepted: true,
          acceptedAt: '2026-05-24T09:00:00.000Z',
          inputs: {
            source: 'customer-interview',
          },
          evidence: {
            priorities: ['Reduce proposal cycle time'],
          },
          scoped_views: {
            customer_problem: {
              summary: 'Proposal teams need a shared governed narrative.',
            },
          },
        },
        sections: {
          customer_problem: '',
        },
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.discovery).toEqual(expect.objectContaining({
      state: expect.objectContaining({
        status: 'ACCEPTED',
      }),
      inputComplete: true,
      evidenceReady: true,
      accepted: true,
      needsRefresh: false,
      acceptedAt: '2026-05-24T09:00:00.000Z',
      inputSummary: {
        keys: ['source'],
        count: 1,
      },
      evidenceSummary: {
        keys: ['priorities'],
        count: 1,
      },
      summarySummary: {
        keys: [],
        count: 0,
      },
      scopedViewSummary: {
        keys: ['customer_problem'],
        count: 1,
      },
      lineageSummary: {
        sourceCount: 0,
        builderMode: '',
      },
      scopedViews: {
        customer_problem: {
          summary: 'Proposal teams need a shared governed narrative.',
        },
      },
    }))
    expect(res.body.data.sections[0].generationEligibility).toEqual(expect.objectContaining({
      canGenerate: true,
      sources: ['DISCOVERY_ACCEPTED'],
    }))
    expect(res.body.data.discovery.inputs).toBeUndefined()
    expect(res.body.data.discovery.evidence).toBeUndefined()
    expect(res.body.data.runtimeInstance.framework_state).toBeUndefined()
    expect(res.body.data.frameworkState).toBeUndefined()
  })

  test('projects normalized source and evidence summaries for legacy accepted discovery packs', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'APPROVED' },
        evidence_pack: {
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
          },
          inputComplete: true,
          evidenceReady: true,
          accepted: true,
          acceptedAt: '2026-05-24T09:00:00.000Z',
          acceptedBy: '69c51e099510a816ace194ef',
          refreshedAt: '2026-05-24T08:55:00.000Z',
          inputs: {
            companyWebsite: 'https://acme.example',
            companyName: 'Acme',
            marketRegion: 'UK enterprise',
            targetOffer: 'Governed proposal workspace',
            notes: 'Prioritize governed evidence reuse.',
          },
          evidence: {
            source: 'DISCOVERY_INPUTS',
          },
          lineage: {
            builder: {
              mode: 'DETERMINISTIC',
            },
            sources: [
              {
                sourceId: 'input_companyWebsite',
                fieldKey: 'companyWebsite',
                type: 'USER_PROVIDED_WEBSITE',
                status: 'USER_PROVIDED',
                url: 'https://acme.example',
              },
              {
                sourceId: 'input_companyName',
                fieldKey: 'companyName',
                type: 'USER_PROVIDED_INPUT',
                status: 'USER_PROVIDED',
              },
              {
                sourceId: 'input_marketRegion',
                fieldKey: 'marketRegion',
                type: 'USER_PROVIDED_INPUT',
                status: 'USER_PROVIDED',
              },
              {
                sourceId: 'input_targetOffer',
                fieldKey: 'targetOffer',
                type: 'USER_PROVIDED_INPUT',
                status: 'USER_PROVIDED',
              },
              {
                sourceId: 'input_notes',
                fieldKey: 'notes',
                type: 'USER_PROVIDED_INPUT',
                status: 'USER_PROVIDED',
              },
            ],
          },
        },
        sections: {
          customer_problem: '',
        },
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.discovery).toEqual(expect.objectContaining({
      accepted: true,
      lineageSummary: {
        sourceCount: 5,
        builderMode: 'DETERMINISTIC',
      },
      sourceRegistrySummary: {
        count: 5,
        sourceTypes: ['WEBSITE', 'DISCOVERY_NOTES'],
      },
      evidenceObjectSummary: {
        evidenceObjectCount: 5,
        acceptedEvidenceCount: 5,
        pendingReviewCount: 0,
        rejectedEvidenceCount: 0,
      },
      discoveryHealth: expect.objectContaining({
        coveragePercent: 40,
        evidenceObjectCount: 5,
        acceptedEvidenceCount: 5,
        pendingReviewCount: 0,
        rejectedEvidenceCount: 0,
        sourceCount: 5,
        missingAreas: expect.arrayContaining(['Services', 'Proof', 'Economics']),
      }),
    }))
    expect(res.body.data.discovery.sourceRegistry).toBeUndefined()
    expect(res.body.data.discovery.evidenceObjects).toBeUndefined()
  })

  test('normalizes discovery booleans strictly and keeps stale accepted evidence ineligible', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: {
          state: {
            status: 'ACCEPTED',
            inputComplete: 'false',
            evidenceReady: 'false',
            accepted: 'false',
            needsRefresh: true,
          },
          inputComplete: 'false',
          evidenceReady: 'false',
          accepted: true,
          needsRefresh: true,
          inputs: {
            source: 'customer-interview',
          },
          evidence: {
            priorities: ['Reduce proposal cycle time'],
          },
        },
        sections: {
          customer_problem: '',
        },
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.discovery).toEqual(expect.objectContaining({
      state: expect.objectContaining({
        status: 'NEEDS_REFRESH',
      }),
      inputComplete: false,
      evidenceReady: false,
      accepted: false,
      needsRefresh: true,
    }))
    expect(res.body.data.sections[0].generationEligibility).toEqual(expect.objectContaining({
      canGenerate: false,
      sources: [],
    }))
  })

  test('disables section generation eligibility when no discovery or section context exists', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('GENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('GENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('GENERATE_SECTION')]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: '',
        },
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.sections[0].generationEligibility).toEqual({
      canGenerate: false,
      reason: 'Accept Intelligence Hub evidence before generating this section.',
      sources: [],
      dependencySectionKeys: [],
      satisfiedDependencySectionKeys: [],
    })
    expect(res.body.data.actions).toEqual([
      expect.objectContaining({
        actionKey: 'GENERATE_SECTION',
        enabled: true,
      }),
    ])
  })

  test('keeps dependency context visible but generation locked until discovery evidence is accepted', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
          validationKeys: ['required-sections-check'],
        },
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
          validationKeys: ['required-sections-check'],
          dependsOnSectionKeys: ['customer_problem'],
        },
      ],
      workflowBindings: [makeWorkflowBinding('GENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-value-drivers',
        pathKey: 'framework_state.sections.value_drivers',
        label: 'Value Drivers',
      }),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        makeUIContract().sections[0],
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          source: 'PACKAGE',
          isCustom: false,
          label: 'Value Drivers',
          displayOrder: 20,
          isVisible: true,
          isEditable: true,
        },
      ],
      actions: [makeUIAction('GENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('GENERATE_SECTION')]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
          value_drivers: '',
        },
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const valueDrivers = res.body.data.sections.find((section) => section.sectionKey === 'value_drivers')
    expect(valueDrivers.generationEligibility).toEqual(expect.objectContaining({
      canGenerate: false,
      reason: 'Accept Intelligence Hub evidence before generating this section.',
      sources: ['DEPENDENT_SECTION_CONTEXT'],
      dependencySectionKeys: ['customer_problem'],
      satisfiedDependencySectionKeys: ['customer_problem'],
    }))
  })

  test('keeps dependency-context generation ineligible when declared dependencies lack context', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
          validationKeys: ['required-sections-check'],
        },
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
          validationKeys: ['required-sections-check'],
          dependsOnSectionKeys: ['customer_problem'],
        },
      ],
      workflowBindings: [makeWorkflowBinding('GENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-value-drivers',
        pathKey: 'framework_state.sections.value_drivers',
        label: 'Value Drivers',
      }),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        makeUIContract().sections[0],
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          source: 'PACKAGE',
          isCustom: false,
          label: 'Value Drivers',
          displayOrder: 20,
          isVisible: true,
          isEditable: true,
        },
      ],
      actions: [makeUIAction('GENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('GENERATE_SECTION')]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: '',
          value_drivers: '',
        },
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const valueDrivers = res.body.data.sections.find((section) => section.sectionKey === 'value_drivers')
    expect(valueDrivers.generationEligibility).toEqual(expect.objectContaining({
      canGenerate: false,
      sources: [],
      dependencySectionKeys: ['customer_problem'],
      satisfiedDependencySectionKeys: [],
    }))
  })

  test('includes readable runtime path projection only for platform debug actors', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })))
    const token = await getAccessTokenForUser(makeSuperAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.runtimeData).toEqual({
      readablePaths: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          value: 'Proposal creation is slow.',
        },
      ],
    })
    expect(res.body.data.diagnostics.runtimePathVisibility).toBe('VISIBLE')
  })

  test('does not allow raw platform roles alone to expose readable runtime paths', async () => {
    Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(
      buildDefaultRoleRows().filter((role) => role.key !== 'SUPER_ADMIN'),
    ))
    User.findById = jest.fn().mockReturnValue(buildUserQueryChain(makeCustomerAdmin({
      memberships: [
        { customerId: null, roles: ['SUPER_ADMIN'] },
        { customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] },
      ],
    })))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin({
      memberships: [
        { customerId: null, roles: ['SUPER_ADMIN'] },
        { customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] },
      ],
    }))

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.runtimeData).toEqual({
      readablePaths: [],
    })
    expect(res.body.data.diagnostics.runtimePathVisibility).toBe('HIDDEN')
  })

  test('renders governed section object model without exposing raw framework state', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: {
              content: 'Customer Problem: Proposal creation is slow.',
              generatedAt: '2026-05-19T08:01:00.000Z',
            },
            review: {
              status: 'PENDING_REVIEW',
            },
            state: {
              status: 'GENERATED',
              revisionCount: 1,
            },
            lineage: {
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
              actionKey: 'GENERATE_SECTION',
            },
            revisions: [
              {
                revisionNumber: 1,
                generated: {
                  content: 'Customer Problem: Previous generated content.',
                },
                replacedAt: '2026-05-19T08:01:00.000Z',
              },
            ],
          },
        },
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.sections).toEqual([
      expect.objectContaining({
        key: 'customer_problem',
        value: 'Proposal creation is slow.',
        generated: expect.objectContaining({
          content: 'Customer Problem: Proposal creation is slow.',
        }),
        review: expect.objectContaining({
          status: 'PENDING_REVIEW',
        }),
        state: expect.objectContaining({
          status: 'GENERATED',
          revisionCount: 1,
        }),
        lineage: expect.objectContaining({
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
        }),
        revisions: [
          expect.objectContaining({
            revisionNumber: 1,
            generated: expect.objectContaining({
              content: 'Customer Problem: Previous generated content.',
            }),
          }),
        ],
      }),
    ])
    expect(res.body.data.runtimeData).toEqual({
      readablePaths: [],
    })
    expect(res.body.data.diagnostics.runtimePathVisibility).toBe('HIDDEN')
    expect(res.body.data.runtimeInstance.framework_state).toBeUndefined()
    expect(res.body.data.frameworkState).toBeUndefined()
  })

  test('renders section fields as read-only when the actor can view but cannot mutate runtime state', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [
        makeWorkflowBinding('SUBMIT_FOR_REVIEW', { executionContext: 'ON_SUBMIT' }),
        makeWorkflowBinding('GENERATE_SECTION'),
        makeWorkflowBinding('REGENERATE_SECTION'),
      ],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [
        makeUIAction('SUBMIT_FOR_REVIEW', {
          confirmationMessage: 'Submit this framework for review?',
          requiresConfirmation: true,
        }),
        makeUIAction('GENERATE_SECTION'),
        makeUIAction('REGENERATE_SECTION'),
      ],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([
      makeWorkflowPolicy(),
      makeActionWorkflowPolicy('GENERATE_SECTION'),
      makeActionWorkflowPolicy('REGENERATE_SECTION'),
    ]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack({
          accepted: true,
          inputs: {
            companyWebsite: 'https://orbit-sensitive.example',
            companyName: 'Orbit Sensitive Services',
            marketRegion: 'Sensitive market region',
            targetOffer: 'Sensitive AI offer',
            notes: 'Sensitive board notes for discovery.',
          },
          state: {
            status: 'ACCEPTED',
            inputComplete: true,
            evidenceReady: true,
            accepted: true,
            needsRefresh: false,
          },
          scoped_views: {
            customer_problem: {
              source: 'DISCOVERY_EVIDENCE_PACK',
              summary: 'Sensitive scoped evidence summary for customer problem.',
              sourceRefs: ['input_targetOffer', 'input_notes'],
            },
          },
        }),
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })))
    const token = await getAccessTokenForUser(makeRegularUser())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.sections).toEqual([
      expect.objectContaining({
        key: 'customer_problem',
        editable: false,
        readonlyReason: 'Current role or permissions do not allow runtime section mutation.',
        requiredPermissions: ['VMF_UPDATE'],
      }),
    ])
    const projectedSection = res.body.data.sections[0]
    const projectedIntelligenceText = JSON.stringify(projectedSection.intelligence)
    expect(projectedIntelligenceText).not.toContain('Orbit Sensitive Services')
    expect(projectedIntelligenceText).not.toContain('Sensitive AI offer')
    expect(projectedIntelligenceText).not.toContain('Sensitive market region')
    expect(projectedIntelligenceText).not.toContain('Sensitive board notes')
    expect(projectedIntelligenceText).not.toContain('Sensitive scoped evidence summary')
    expect(projectedSection.intelligence.supportingEvidence).toEqual([])
    expect(projectedSection.intelligence.displayProjection.supportingEvidence.items).toEqual([])
    expect(res.body.data.discovery.inputValues).toBeUndefined()
    expect(res.body.data.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actionKey: 'SUBMIT_FOR_REVIEW',
        enabled: false,
        disabledReason: 'Current role or permissions do not allow this runtime action.',
      }),
      expect.objectContaining({
        actionKey: 'GENERATE_SECTION',
        enabled: false,
        disabledReason: 'Current role or permissions do not allow this runtime action.',
        requiredPermissions: ['VMF_UPDATE'],
      }),
      expect.objectContaining({
        actionKey: 'REGENERATE_SECTION',
        enabled: false,
        disabledReason: 'Current role or permissions do not allow this runtime action.',
        requiredPermissions: ['VMF_UPDATE'],
      }),
    ]))
  })

  test('does not expose runtime data outside registered READ runtime paths', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
          validationKeys: ['required-sections-check'],
        },
        {
          sectionKey: 'hidden_secret',
          runtimePath: 'framework_state.sections.hidden_secret',
          required: false,
          validationKeys: [],
        },
        {
          sectionKey: 'write_only',
          runtimePath: 'framework_state.sections.write_only',
          required: false,
          validationKeys: [],
        },
      ],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-write-only',
        pathKey: 'framework_state.sections.write_only',
        label: 'Write Only',
        allowedOperations: ['WRITE'],
      }),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
          hidden_secret: 'LEAKED_SECRET_VALUE',
          write_only: 'WRITE_ONLY_SECRET_VALUE',
        },
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.sections).toHaveLength(1)
    expect(res.body.data.runtimeData).toEqual({
      readablePaths: [],
    })
    expect(JSON.stringify(res.body.data)).not.toContain('LEAKED_SECRET_VALUE')
    expect(JSON.stringify(res.body.data)).not.toContain('WRITE_ONLY_SECRET_VALUE')
    expect(res.body.data.runtimeInstance.framework_state).toBeUndefined()
    expect(res.body.data.frameworkState).toBeUndefined()
    expect(res.body.data.diagnostics.configWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'RUNTIME_PATH_NOT_FOUND',
        severity: 'ERROR',
        sectionKey: 'hidden_secret',
      }),
      expect.objectContaining({
        code: 'RUNTIME_PATH_NOT_READABLE',
        severity: 'ERROR',
        sectionKey: 'write_only',
      }),
    ]))
  })

  test('skips package sections whose runtime path is not registered and returns a renderer config warning', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.sections).toEqual([])
    expect(res.body.data.diagnostics.configWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'RUNTIME_PATH_NOT_FOUND',
        severity: 'ERROR',
        sectionKey: 'customer_problem',
        runtimePath: 'framework_state.sections.customer_problem',
      }),
    ]))
  })

  test('disables UI Contract actions that have no matching active workflow policy', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.actions).toEqual([
      expect.objectContaining({
        actionKey: 'SUBMIT_FOR_REVIEW',
        enabled: false,
        warnings: ['ACTION_POLICY_MISSING'],
      }),
    ])
    expect(res.body.data.diagnostics.configWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'ACTION_POLICY_MISSING',
        severity: 'WARNING',
        actionKey: 'SUBMIT_FOR_REVIEW',
        governedAction: 'SUBMIT_FOR_REVIEW',
      }),
    ]))
  })

  test('does not render workflow policy actions that are absent from the UI Contract', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({ actions: [] })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.actions).toEqual([])
    expect(res.body.data.diagnostics.configWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'POLICY_ACTION_MISSING',
        severity: 'WARNING',
        governedAction: 'SUBMIT_FOR_REVIEW',
        policyKey: 'submit-for-review-policy',
      }),
    ]))
  })

  test('disables action UI for non-executable workflow policy decisions', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([
      makeWorkflowPolicy({ decisionMode: 'WARN_ONLY' }),
    ]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.actions).toEqual([
      expect.objectContaining({
        actionKey: 'SUBMIT_FOR_REVIEW',
        enabled: false,
        policyDecisionMode: 'WARN_ONLY',
        disabledReason: 'Workflow policy decision mode is not executable by the renderer.',
      }),
    ])
  })

  test('disables action UI when the actor lacks the action-level runtime permission', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    const token = await getAccessTokenForUser(makeRegularUser())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.actions).toEqual([
      expect.objectContaining({
        actionKey: 'SUBMIT_FOR_REVIEW',
        enabled: false,
        requiredPermissions: ['VMF_UPDATE'],
        disabledReason: 'Current role or permissions do not allow this runtime action.',
      }),
    ])
  })

  test('defaults Discovery Evidence action projection to VMF_UPDATE for view-only users', async () => {
    const discoveryActions = [
      'SAVE_DISCOVERY_INPUTS',
      'BUILD_EVIDENCE_PACK',
      'REFRESH_EVIDENCE_PACK',
      'ACCEPT_EVIDENCE',
    ]
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: discoveryActions.map((actionKey) => makeWorkflowBinding(actionKey)),
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: discoveryActions.map((actionKey) => makeUIAction(actionKey)),
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery(
      discoveryActions.map((actionKey) => makeActionWorkflowPolicy(actionKey)),
    ))
    const token = await getAccessTokenForUser(makeRegularUser())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    discoveryActions.forEach((actionKey) => {
      expect(res.body.data.actions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          actionKey,
          enabled: false,
          requiredPermissions: ['VMF_UPDATE'],
          disabledReason: 'Current role or permissions do not allow this runtime action.',
        }),
      ]))
    })
  })

  test('disables action UI for customer-scoped tenant admins who can view but are not assigned to mutate the tenant', async () => {
    const tenantAdmin = makeCustomerScopedTenantAdmin()
    User.findById = jest.fn().mockImplementation((userId) => {
      if (userId === REGULAR_USER_ID) return buildUserQueryChain(tenantAdmin)
      return buildUserQueryChain(null)
    })
    Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildTenantAdminRoleRows()))
    Tenant.findById = jest.fn().mockResolvedValue(makeTenant({
      tenantAdminUserIds: [],
    }))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    const token = await getAccessTokenForUser(tenantAdmin)

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.actions).toEqual([
      expect.objectContaining({
        actionKey: 'SUBMIT_FOR_REVIEW',
        enabled: false,
        requiredPermissions: ['VMF_UPDATE'],
        disabledReason: 'Current role or permissions do not allow this runtime action.',
      }),
    ])
  })

  test('fails closed when runtime deployment snapshot evidence is missing', async () => {
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      evidence: {
        activationId: 'activation-vmf-2-3-1-001',
        deploymentId: 'deployment-vmf-global-production-001',
        dependencySnapshotId: 'dep-lock-vmf-standard-2-3-1',
        dependencySnapshotHash: '',
      },
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('DEPLOYMENT_SNAPSHOT_MISMATCH')
    expect(res.body.error.details.missingEvidence).toEqual(['dependencySnapshotHash'])
    expect(RuntimePathRegistry.find).not.toHaveBeenCalled()
    expect(UIContract.findOne).not.toHaveBeenCalled()
    expect(WorkflowPolicy.find).not.toHaveBeenCalled()
  })

  test('fails closed for Deal Analysis renderer requests without a locked runtime anchor', async () => {
    Customer.findById = jest.fn().mockResolvedValue(makeCustomer({ entitlements: ['DEALS'] }))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      runtimeType: 'DEAL_ANALYSIS',
      anchors: [],
    })))
    const token = await getAccessTokenForUser(makeRegularUser())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('DEAL_ANALYSIS_ANCHOR_REQUIRED')
    expect(FrameworkPackage.findById).not.toHaveBeenCalled()
    expect(RuntimePathRegistry.find).not.toHaveBeenCalled()
    expect(UIContract.findOne).not.toHaveBeenCalled()
    expect(WorkflowPolicy.find).not.toHaveBeenCalled()
  })

  test('fails closed for Deal Analysis renderer requests whose anchor is not a locked VMF runtime in scope', async () => {
    Customer.findById = jest.fn().mockResolvedValue(makeCustomer({ entitlements: ['DEALS'] }))
    RuntimeInstance.findOne = jest.fn()
      .mockReturnValueOnce(buildLeanQuery(makeRuntimeInstance({
        runtimeType: 'DEAL_ANALYSIS',
        frameworkKey: 'DEALS',
        anchors: [
          {
            runtimeInstanceId: 'b37f1f77bcf86cd799439222',
            runtimeInstanceKey: 'value-narrative-anchor',
            runtimeType: 'VALUE_NARRATIVE',
            relationship: 'VALUE_NARRATIVE_ANCHOR',
            lockedAt: '2026-05-19T12:00:00.000Z',
          },
        ],
      })))
      .mockReturnValueOnce(buildLeanQuery(makeRuntimeInstance({
        _id: 'b37f1f77bcf86cd799439222',
        id: 'b37f1f77bcf86cd799439222',
        runtimeInstanceKey: 'value-narrative-anchor',
        runtimeType: 'VALUE_NARRATIVE',
        frameworkKey: 'VMF',
        status: 'ACTIVE',
      })))
    const token = await getAccessTokenForUser(makeRegularUser())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('DEAL_ANALYSIS_ANCHOR_REQUIRED')
    expect(res.body.error.details.failedChecks).toEqual(['status'])
    expect(FrameworkPackage.findById).not.toHaveBeenCalled()
    expect(RuntimePathRegistry.find).not.toHaveBeenCalled()
    expect(UIContract.findOne).not.toHaveBeenCalled()
    expect(WorkflowPolicy.find).not.toHaveBeenCalled()
  })
})
