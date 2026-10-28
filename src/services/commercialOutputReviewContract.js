import { createHash } from 'node:crypto'
import { assertCommercialOutputContract } from '../utils/outcomeCommercialExpressionProfile.js'
import { assertOutcomeSelectedDocumentPrivacy } from './outcomeStudioProviderSafeContextService.js'
import { assertStyleOverlaySourceEligibility } from './styleOverlayPolicy.js'

export const buildCommercialStyleValidationReceipt = ({ contract, styleSource, title, sections, audienceKeys = [], outputAssetId }) => {
  assertCommercialOutputContract(contract)
  if (typeof outputAssetId !== 'string' || !/^[A-Z][A-Z0-9-]+$/.test(outputAssetId)) throw new TypeError('Selected output asset identity is required.')
  const style = contract.packs.find(pack => pack.packType === 'STYLE')
  const eligibility = assertStyleOverlaySourceEligibility({ style: { ...style, status: 'ACTIVE' },
    outputType: { ...contract.packs.find(pack => pack.packType === 'OUTPUT_TYPE_DEFINITION'), knowledgeAssetId: outputAssetId },
    schema: contract.packs.find(pack => pack.packType === 'OUTPUT_SCHEMA'),
    audienceKeys, format: 'MARKDOWN', loaded: styleSource })
  if (sections.length !== contract.sections.length || sections.some((section, index) => section.sectionKey !== contract.sections[index])) {
    throw new TypeError('Style overlay must preserve the selected semantic sections.')
  }
  return { ...eligibility, contractVersion: 'commercial-style-validation.v1',
    selectedPacks: contract.packs,
    paperFingerprint: createHash('sha256').update(JSON.stringify({ title, sections })).digest('hex'),
    validation: { sectionOrder: 'PRESERVED', meaningAttributionAndQualifications: 'EXACT_SAVED_NARRATIVE_RECIPE',
      audience: 'EXPLICIT_EXCLUSIONS_CHECKED', renderer: 'REGISTERED_CAPABILITIES_CHECKED',
      accessibilityAndVisualQuality: 'REQUIRES_RL' } }
}

export const COMMERCIAL_RL_CONTEXT_VERSION = 'fs-003-rendered-expression-rl-provider-safe-context.v0.3'
const descriptorKeys = ['packType', 'packId', 'packKey', 'versionId', 'semanticVersion', 'contentHash']
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const reject = () => { throw new TypeError('Selected output review contract is unavailable or mismatched.') }

// These are the selected output's requirements, not extra RL method documents.
// Full source text is retained and hash-checked; no excerpts replace a pack.
export const assertCommercialReviewDocuments = (documents, contract) => {
  assertCommercialOutputContract(contract)
  if (!Array.isArray(documents) || documents.length !== contract.packs.length) reject()
  documents.forEach((document, index) => {
    if (!exact(document, ['source', 'content'])
      || !exact(document.source, [...descriptorKeys, 'contentFormat'])
      || descriptorKeys.some((key) => document.source[key] !== contract.packs[index][key])
      || !['MARKDOWN', 'JSON', 'YAML', 'YML'].includes(document.source.contentFormat)
      || typeof document.content !== 'string'
      || Buffer.byteLength(document.content, 'utf8') > 200000
      || `sha256:${createHash('sha256').update(document.content, 'utf8').digest('hex')}` !== document.source.contentHash) reject()
    assertOutcomeSelectedDocumentPrivacy(document.content)
  })
  return documents
}

export const loadCommercialReviewDocuments = async ({ contract, loadPackContent }) => {
  assertCommercialOutputContract(contract)
  if (typeof loadPackContent !== 'function') reject()
  const documents = await Promise.all(contract.packs.map(async (pack) => {
    const loaded = await loadPackContent({ packId: pack.packId, versionId: pack.versionId })
    if (!loaded?.available || loaded.status !== 'ACTIVE'
      || descriptorKeys.filter((key) => key !== 'packType').some((key) => loaded[key] !== pack[key])) reject()
    return { source: { ...pack, contentFormat: loaded.contentFormat }, content: loaded.content }
  }))
  return assertCommercialReviewDocuments(documents, contract)
}

export const commercialReviewDocumentReceipts = (documents, contract) => {
  assertCommercialReviewDocuments(documents, contract)
  return documents.map(({ source, content }) => ({ ...source,
    characterCount: content.length, byteCount: Buffer.byteLength(content, 'utf8'),
  }))
}
