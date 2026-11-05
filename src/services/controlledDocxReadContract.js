import { createHash } from 'node:crypto'
import { APPROVED_DOCX_READ_VERSION, APPROVED_DOCX_RESULT_VERSION, APPROVED_DOCX_READ_SELECTION,
  APPROVED_DOCX_READ_HASHES, APPROVED_DOCX_READ_PAGES,
  NARROW_DOCX_READ_VERSION, NARROW_DOCX_RESULT_VERSION, NARROW_DOCX_READ_SELECTION,
  NARROW_DOCX_READ_HASHES, NARROW_DOCX_READ_PREVIEW_HASHES, NARROW_DOCX_READ_PAGES } from './approvedDocxReadProfile.js'

export const CONTROLLED_DOCX_READ_VERSION = 'CONTROLLED_DOCX_READ_V1'
export const CONTROLLED_DOCX_RESULT_VERSION = 'CONTROLLED_DOCX_READ_RESULT_V1'
export const CONTROLLED_DOCX_IDENTITY = Object.freeze({
  actorUserId: '6a6c763dcace7a21bd41efa9',
  customerId: '6a6c75f2cace7a21bd41ef98',
  tenantId: '6a6c76e3cace7a21bd41eff9',
  runtimeInstanceId: '6ad715c91f39fea112115875',
  candidateId: 'docx_candidate_45e4cd08-6750-4ebf-88d2-a97c81dc3d4b',
  previewId: 'docx_preview_dee34d52-51b6-4667-930b-a991985ca0b1',
})
// A separately selected private correction never renews the original review release.
export const CORRECTED_DOCX_READ_VERSION = 'CONTROLLED_DOCX_READ_V2'
export const CORRECTED_DOCX_RESULT_VERSION = 'CONTROLLED_DOCX_READ_RESULT_V2'
export const CORRECTED_DOCX_IDENTITY = Object.freeze({ ...CONTROLLED_DOCX_IDENTITY,
  candidateId: 'docx_candidate_7c552bd4-90e9-43f8-8305-d1d6cfbb0a0a',
  previewId: 'docx_preview_0b5901f9-bdc3-4b1e-b6f2-caf8140a5f04',
})
export const CORRECTED_DOCX_HASHES = Object.freeze({
  "sourceFingerprint": "51cc8bf0b164db4e60438cb1559e62bf9a19b3cb2ebff4ffb0522f3ea57a9891",
  "inputFingerprint": "57b31a2ce91d97474b810dccf9f6297443228fa4a113762c1311d1e515a7bca0",
  "bodyFingerprint": "640c80cefea900edb60b491bb00dc8ef831c953c17b920de840b801a0f87a75a",
  "masterBindingFingerprint": "1b880d459255e2181bd4f830d7e721cd3eb195506a7e9b91d8db9dad0fad3354",
  "outputChecksum": "sha256:da0cac47f6341732477992fc211f66ee020e0d46997c2c6d5554d8484be59421"
})
export const CORRECTED_DOCX_PAGES = Object.freeze([
  {
    "number": 1,
    "width": 1275,
    "height": 1651,
    "byteLength": 306991,
    "sha256": "230e4018746416f41b6455d8bf5ba4279d7a63040adca8bd20fc8207e512de53"
  },
  {
    "number": 2,
    "width": 1275,
    "height": 1651,
    "byteLength": 406840,
    "sha256": "1bc1efcf744152d284a52d634fa4958073bba653aca038078c578bd82505a611"
  },
  {
    "number": 3,
    "width": 1275,
    "height": 1651,
    "byteLength": 417799,
    "sha256": "ab3f3bc91d366cd5da8808fbc126cd39f87645a9a6988cc996bb5b8038446a58"
  },
  {
    "number": 4,
    "width": 1275,
    "height": 1651,
    "byteLength": 389582,
    "sha256": "1925fbeddcf2bb69b2f8155a4b25d9385dd2c8a46082ab944fc5d92ca65090fc"
  },
  {
    "number": 5,
    "width": 1275,
    "height": 1651,
    "byteLength": 421381,
    "sha256": "daba8a8b348dffc2f494a6afec9f39d6a19d5e5741203e204a4c974affd35b64"
  },
  {
    "number": 6,
    "width": 1275,
    "height": 1651,
    "byteLength": 459745,
    "sha256": "469017b447a2bd4a697f19dfd60c7580706a98dba1c61e9e86d476a27a648f95"
  },
  {
    "number": 7,
    "width": 1275,
    "height": 1651,
    "byteLength": 57561,
    "sha256": "75ffbeb2ad6e7f163a2bae0b75492f11c54f22fb63f3024259f38bebaf709d9c"
  }
].map(page => Object.freeze(page)))
export const CONTROLLED_DOCX_DATABASE = 'ss044_1619d7db635949898c9abb4592d10bcf'
export const CONTROLLED_DOCX_READ_LIMITS = Object.freeze({
  requestBytes: 4096, resultBytes: 12 * 1024 ** 2, diagnosticsBytes: 4096,
  deadlineMs: 480000, closeMs: 5000, readCalls: 10000, namespaces: 80,
})
export const CONTROLLED_DOCX_PROVENANCE = Object.freeze({
  contractVersion: 'controlled-docx-storage.v1', kind: 'CONTROLLED_SNAPSHOT',
  sourceCurrentness: 'ISOLATED_READ_OBSERVATION_ONLY', nativeAccess: 'CHECKED_FOR_THIS_RESPONSE',
  customerApproved: false, authorisesApproval: false,
})
export const controlledDocxReadFailure = (reason, status = 409) => Object.assign(
  new Error('The controlled saved document is unavailable. No approval or delivery is authorised.'),
  { status, code: 'CONTROLLED_DOCX_READ_UNAVAILABLE', details: { reason } },
)
const fail = reason => { throw controlledDocxReadFailure(reason) }
export const exactReadObject = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
export const controlledScope = () => Object.fromEntries(
  ['customerId', 'tenantId', 'runtimeInstanceId'].map(key => [key, CONTROLLED_DOCX_IDENTITY[key]]),
)
export const controlledReadProfile = version => {
  if (version === NARROW_DOCX_READ_VERSION) return { identity: { ...CONTROLLED_DOCX_IDENTITY, ...NARROW_DOCX_READ_SELECTION },
    resultVersion: NARROW_DOCX_RESULT_VERSION, pages: NARROW_DOCX_READ_PAGES.length, corrected: false, approved: false, narrow: true }
  if (version === APPROVED_DOCX_READ_VERSION) return { identity: { ...CONTROLLED_DOCX_IDENTITY, ...APPROVED_DOCX_READ_SELECTION },
    resultVersion: APPROVED_DOCX_RESULT_VERSION, pages: 7, corrected: false, approved: true }
  if (version === CONTROLLED_DOCX_READ_VERSION) return { identity: CONTROLLED_DOCX_IDENTITY, resultVersion: CONTROLLED_DOCX_RESULT_VERSION, pages: 6, corrected: false }
  if (version === CORRECTED_DOCX_READ_VERSION) return { identity: CORRECTED_DOCX_IDENTITY, resultVersion: CORRECTED_DOCX_RESULT_VERSION, pages: 7, corrected: true }
  fail('REQUEST_INVALID')
}
export const assertControlledReadRequest = (request) => {
  const profile = controlledReadProfile(request?.contractVersion)
  const keys = ['contractVersion', 'operation', 'scope', ...(request?.operation === 'CURRENT_PREVIEW' ? ['candidateId'] : [])]
  if (!exactReadObject(request, keys) || ![CONTROLLED_DOCX_READ_VERSION, CORRECTED_DOCX_READ_VERSION, APPROVED_DOCX_READ_VERSION, NARROW_DOCX_READ_VERSION].includes(request.contractVersion)
    || !['LIST', 'CURRENT_PREVIEW'].includes(request.operation)
    || !exactReadObject(request.scope, ['actorUserId', 'customerId', 'tenantId', 'runtimeInstanceId'])
    || Object.keys(request.scope).some(key => request.scope[key] !== profile.identity[key])
    || (request.operation === 'CURRENT_PREVIEW' && request.candidateId !== profile.identity.candidateId)
    || Buffer.byteLength(JSON.stringify(request)) > CONTROLLED_DOCX_READ_LIMITS.requestBytes) fail('REQUEST_INVALID')
  return request
}
const held = value => value?.classification === 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST'
  && ['authoritative', 'officialUse', 'normalOutputAvailable', 'authorisesApproval', 'finalisationAvailable', 'deliveryAvailable'].every(key => value[key] === false)
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const canonical = value => value && Object.getPrototypeOf(value) === Object.prototype
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const jsonHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const correctedCandidateValid = candidate => {
  const binding = candidate.masterBinding
  return Object.entries(CORRECTED_DOCX_HASHES).every(([key, value]) => key === 'outputChecksum' ? candidate.artifact?.outputChecksum === value : candidate[key] === value)
    && candidate.artifact?.byteLength === 13688
    && exactReadObject(binding, ['contractVersion', 'masterReference', 'expressionOrigin', 'wrapperFingerprint', 'correctionReference'])
    && binding.contractVersion === 'master-linked-private-docx-binding.v2'
    && binding.expressionOrigin === 'VERSIONED_COMMERCIAL_CORRECTION_UNREVIEWED'
    && jsonHash(canonical(binding)) === CORRECTED_DOCX_HASHES.masterBindingFingerprint
}
const approvedCandidateValid = candidate => Object.entries(APPROVED_DOCX_READ_HASHES).every(([key, value]) =>
  key === 'outputChecksum' ? candidate.artifact?.outputChecksum === value : candidate[key] === value)
  && candidate.artifact?.byteLength === 13712
  && exactReadObject(candidate.masterBinding, ['contractVersion', 'masterReference', 'expressionOrigin', 'wrapperFingerprint', 'compatibilityReference'])
  && candidate.masterBinding.contractVersion === 'master-linked-private-docx-binding.v3'
  && candidate.masterBinding.expressionOrigin === 'APPROVED_EXPRESSION_PRIVATE_CORRECTION_UNREVIEWED'
  && jsonHash(canonical(candidate.masterBinding)) === APPROVED_DOCX_READ_HASHES.masterBindingFingerprint
const narrowCandidateValid = candidate => Object.entries(NARROW_DOCX_READ_HASHES).every(([key, value]) =>
  key === 'outputChecksum' ? candidate.artifact?.outputChecksum === value : candidate[key] === value)
  && candidate.artifact?.byteLength === 13767 && candidate.renderer?.layoutProfile === 'SOURCE_SCOPED_QUOTATIONS_V2'
  && exactReadObject(candidate.masterBinding, ['contractVersion', 'masterReference', 'expressionOrigin', 'wrapperFingerprint', 'compatibilityReference'])
  && candidate.masterBinding.contractVersion === 'master-linked-private-docx-binding.v4'
  && candidate.masterBinding.expressionOrigin === 'NARROW_EXPRESSION_PRIVATE_CORRECTION_UNREVIEWED'
  && candidate.masterBinding.compatibilityReference?.version === 'commercial-docx-approved-expression.v2'
  && jsonHash(canonical(candidate.masterBinding)) === NARROW_DOCX_READ_HASHES.masterBindingFingerprint
export const assertControlledReadData = (operation, data, version = CONTROLLED_DOCX_READ_VERSION) => {
  const profile = controlledReadProfile(version), fixed = profile.identity
  if (!data || Buffer.byteLength(JSON.stringify(data)) > CONTROLLED_DOCX_READ_LIMITS.resultBytes) fail('RESULT_INVALID')
  if (operation === 'LIST') {
    if (!exactReadObject(data, ['scope', 'sourceFingerprint', 'candidates']) || !hash(data.sourceFingerprint)
      || !data.scope || Object.entries(controlledScope()).some(([key, value]) => data.scope[key] !== value)
      || !Array.isArray(data.candidates) || data.candidates.length !== 1) fail('RESULT_SCOPE_INVALID')
    const candidate = data.candidates[0]
    if (!held(candidate) || candidate.candidateId !== fixed.candidateId
      || candidate.contractVersion !== 'private-docx-candidate.v2' || candidate.status !== 'PRIVATE_UNREVIEWED'
      || candidate.renderer?.version !== (profile.narrow ? '0.1.5' : profile.approved ? '0.1.4' : '0.1.3') || candidate.sourceFingerprint !== data.sourceFingerprint
      || !hash(candidate.inputFingerprint) || !hash(candidate.bodyFingerprint) || !hash(candidate.masterBindingFingerprint)
      || candidate.artifact?.format !== 'DOCX' || !/^sha256:[a-f0-9]{64}$/.test(candidate.artifact?.outputChecksum || '')) fail('RESULT_CANDIDATE_INVALID')
    if (profile.corrected && !correctedCandidateValid(candidate)) fail('RESULT_CANDIDATE_INVALID')
    if (profile.approved && !approvedCandidateValid(candidate)) fail('RESULT_CANDIDATE_INVALID')
    if (profile.narrow && !narrowCandidateValid(candidate)) fail('RESULT_CANDIDATE_INVALID')
  } else if (operation === 'CURRENT_PREVIEW') {
    const preview = data.preview
    if (!exactReadObject(data, ['preview', 'pages', 'document']) || !held(preview) || preview.previewId !== fixed.previewId
      || preview.candidateId !== fixed.candidateId
      || preview.contractVersion !== 'private-docx-page-preview.v2' || preview.status !== 'PRIVATE_PREVIEW_ONLY'
      || Object.entries(controlledScope()).some(([key, value]) => preview.scope?.[key] !== value)
      || preview.renderer?.version !== (profile.narrow ? '0.1.5' : profile.approved ? '0.1.4' : '0.1.3') || !Array.isArray(data.pages) || data.pages.length !== profile.pages
      || !['sourceFingerprint', 'inputFingerprint', 'candidateBodyFingerprint', 'masterBindingFingerprint'].every(key => hash(preview[key]))
      || !exactReadObject(data.document, ['title', 'markdown', 'inputFingerprint'])
      || typeof data.document.title !== 'string' || !data.document.title.trim()
      || typeof data.document.markdown !== 'string' || !data.document.markdown.trim()
      || Buffer.byteLength(data.document.markdown) > 1024 ** 2
      || data.document.inputFingerprint !== preview.inputFingerprint
      || preview.conversion?.contractVersion !== 'DOCX_PAGE_PREVIEW_V1'
      || !Array.isArray(preview.conversion.pages) || preview.conversion.pages.length !== profile.pages) fail('RESULT_PREVIEW_INVALID')
    const pinned = profile.corrected || profile.approved || profile.narrow
    const hashes = profile.narrow ? NARROW_DOCX_READ_HASHES : profile.approved ? APPROVED_DOCX_READ_HASHES : CORRECTED_DOCX_HASHES
    if (pinned && (preview.sourceFingerprint !== hashes.sourceFingerprint
      || preview.inputFingerprint !== hashes.inputFingerprint
      || preview.candidateBodyFingerprint !== hashes.bodyFingerprint
      || preview.masterBindingFingerprint !== hashes.masterBindingFingerprint
      || preview.conversion.docxChecksum !== hashes.outputChecksum
      || !hash(preview.conversionFingerprint) || jsonHash(preview.conversion) !== preview.conversionFingerprint)) fail('RESULT_PREVIEW_INVALID')
    if (profile.narrow && (preview.renderer.layoutProfile !== 'SOURCE_SCOPED_QUOTATIONS_V2'
      || preview.conversionFingerprint !== NARROW_DOCX_READ_PREVIEW_HASHES.conversionFingerprint
      || preview.conversion.runtimeFingerprint !== NARROW_DOCX_READ_PREVIEW_HASHES.runtimeFingerprint
      || jsonHash(preview.conversion.runtime) !== NARROW_DOCX_READ_PREVIEW_HASHES.runtimeFingerprint)) fail('RESULT_PREVIEW_INVALID')
    if (pinned && preview.conversion.pages.some((page, index) => {
      const expected = (profile.narrow ? NARROW_DOCX_READ_PAGES : profile.approved ? APPROVED_DOCX_READ_PAGES : CORRECTED_DOCX_PAGES)[index]
      return !exactReadObject(page, Object.keys(expected)) || Object.entries(expected).some(([key, value]) => page[key] !== value)
    })) fail('RESULT_PAGE_INVALID')
    let total = 0
    for (const [index, page] of data.pages.entries()) {
      const expected = preview.conversion.pages[index]
      if (!exactReadObject(page, ['number', 'mimeType', 'base64']) || page.number !== index + 1
        || expected?.number !== index + 1 || page.mimeType !== 'image/png'
        || typeof page.base64 !== 'string' || page.base64.length > Math.ceil(2 * 1024 ** 2 / 3) * 4
        || page.base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(page.base64)
        || !hash(expected.sha256) || ![expected.width, expected.height].every(value => Number.isInteger(value) && value > 0 && value <= 2500)) fail('RESULT_PAGE_INVALID')
      const bytes = Buffer.from(page.base64, 'base64')
      total += bytes.length
      if (bytes.length < 24 || bytes.length !== expected.byteLength || bytes.length > 2 * 1024 ** 2 || total > 8 * 1024 ** 2
        || bytes.toString('base64') !== page.base64 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
        || bytes.readUInt32BE(16) !== expected.width || bytes.readUInt32BE(20) !== expected.height
        || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) fail('RESULT_PAGE_INVALID')
    }
  } else fail('OPERATION_INVALID')
  return data
}
export const attachControlledReadProvenance = (operation, data) => operation === 'LIST'
  ? { ...data, candidates: data.candidates.map(candidate => ({ ...candidate, storageProvenance: { ...CONTROLLED_DOCX_PROVENANCE } })) }
  : { ...data, preview: { ...data.preview, storageProvenance: { ...CONTROLLED_DOCX_PROVENANCE } } }
