import { buildStructuredExpressionSection } from './outcomeStructuredExpressionProfile.js'
import { presentSourceQualification } from './outcomePresentationExpressionProfile.js'

export const OUTCOME_COMMERCIAL_EXPRESSION_PROFILE_VERSION = 'outcome-commercial-expression.v1'
export const OUTCOME_COMMERCIAL_CANDIDATE_TYPE = 'COMMERCIAL_STRATEGY_AND_DECISION_PAPER'
export const COMMERCIAL_OUTPUT_SECTION_KEYS = Object.freeze([
  'title-and-decision-context', 'executive-conclusion', 'decision-requested',
  'current-reality-and-evidence-state', 'commercial-diagnosis', 'decision-boundaries',
  'value-and-economic-pathways', 'target-context-and-stakeholders',
  'recommended-course-and-progression', 'risks-and-guardrails',
  'decisions-to-approve-and-withhold', 'confidence-and-evidence-requirements',
  'next-legal-downstream-action', 'source-and-lineage-record',
])
const contractKeys = ['outputTypeKey', 'outputSchemaKey', 'styleKey', 'visualSystemKey', 'sections', 'packs']
const descriptorKeys = ['packType', 'packId', 'packKey', 'versionId', 'semanticVersion', 'contentHash']
const roles = ['OUTPUT_TYPE_DEFINITION', 'OUTPUT_SCHEMA', 'STYLE', 'VISUAL_SYSTEM']
const keyFields = ['outputTypeKey', 'outputSchemaKey', 'styleKey', 'visualSystemKey']
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const token = (value) => typeof value === 'string' && value.length > 0 && value.length <= 300
  && value.trim() === value && ![...value].some((character) => character.charCodeAt(0) < 32)
const stableKey = (value) => token(value) && /^[a-z\d][a-z\d-]*$/.test(value)
const invalid = () => { throw new TypeError('The selected Commercial output contract is missing, ambiguous or inconsistent.') }
const plain = (value) => value?.toObject ? value.toObject() : value
const comparable = (value) => JSON.stringify({
  ...Object.fromEntries(keyFields.map((key) => [key, value[key]])), sections: value.sections,
  packs: value.packs.map((pack) => Object.fromEntries(descriptorKeys.map((key) => [key, pack[key]]))),
})

export const assertCommercialOutputContract = (value, { plan } = {}) => {
  if (!exact(value, contractKeys)
    || !keyFields.every((key) => stableKey(value[key]))
    || value.outputTypeKey !== 'commercial-strategy-and-decision-paper'
    || value.outputSchemaKey !== 'commercial-strategy-and-decision-paper-schema'
    || JSON.stringify(value.sections) !== JSON.stringify(COMMERCIAL_OUTPUT_SECTION_KEYS)
    || !Array.isArray(value.packs) || value.packs.length !== roles.length) invalid()
  value.packs.forEach((pack, index) => {
    if (!exact(pack, descriptorKeys) || pack.packType !== roles[index]
      || pack.packKey !== value[keyFields[index]] || !descriptorKeys.every((key) => token(pack[key]))
      || !/^sha256:[a-f\d]{64}$/.test(pack.contentHash)
      || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(pack.semanticVersion)) invalid()
  })
  if (plan && comparable(value) !== comparable(buildCommercialOutputContract({ plan }))) invalid()
  return value
}

export const buildCommercialOutputContract = ({ plan: value } = {}) => {
  const plan = plain(value), intent = plan?.payload?.consumerIntent
  const selected = plan?.payload?.resolution?.selectedPacks
  if (!intent || !Array.isArray(selected)
    || intent.requestedOutputTypeKey !== 'commercial-strategy-and-decision-paper'
    || plan.requestedOutputTypeKey !== intent.requestedOutputTypeKey) invalid()
  const request = intent.compositionResolution?.request
  const output = {
    outputTypeKey: intent.requestedOutputTypeKey,
    outputSchemaKey: 'commercial-strategy-and-decision-paper-schema',
    styleKey: request?.requestedStyleKey,
    visualSystemKey: request?.visualSystemKey,
    sections: [...COMMERCIAL_OUTPUT_SECTION_KEYS],
    packs: roles.map((role, index) => {
      const matches = selected.filter((pack) => pack.packType === role)
      if (matches.length !== 1 || matches[0].lifecycleStatus !== 'ACTIVE') invalid()
      const pack = matches[0]
      if (pack.packKey !== (index === 0 ? intent.requestedOutputTypeKey
        : index === 1 ? 'commercial-strategy-and-decision-paper-schema'
        : index === 2 ? request?.requestedStyleKey : request?.visualSystemKey)) invalid()
      return Object.fromEntries(descriptorKeys.map((key) => [key, pack[key]]))
    }),
  }
  return assertCommercialOutputContract(output)
}

export const getCommercialDiagramApplicability = (sections) => {
  if (!Array.isArray(sections) || sections.length !== 14) invalid()
  return sections.some((section) => section.diagram ? section.diagram.present : Boolean(String(section.diagramIntent || '').trim()))
    ? 'Diagrams are described in the sections where they are specified.'
    : 'No diagrams are used in this document.'
}

const render = (block) => block.kind === 'LABEL' ? `${'#'.repeat(block.level)} ${block.text}`
  : ['SOURCE_QUOTATION', 'INTAKE'].includes(block.kind) ? `> ${block.text}` : block.text
const sourceLimit = (originals) => {
  // Only recognised, already-approved source qualifications enter this recipe.
  originals.forEach(presentSourceQualification)
  const contains = (prefix) => originals.some((value) => value.startsWith(prefix))
  return [
    contains('Disposable synthetic test only;') ? 'Verbatim synthetic quotation, not real-customer or operations evidence.' : '',
    contains('SOURCE_PRESENTED exact statement only.') ? 'Authenticity and business truth are unverified.' : '',
    contains('Claim effective date,') ? 'Claim date/currentness/measurement are unknown; capture/upload is not a claim date.' : '',
    originals.some((value) => /^R\d+ fictional scenario reused unchanged/.test(value)) ? 'Authored copies add neither new support nor independent corroboration.' : '',
    contains('Legacy text-source location') ? 'Text location: external frozen-ledger match only; no application capture-span receipt.' : '',
  ].filter(Boolean).join(' ')
}

export const buildCommercialExpressionSection = (section, { sections = [] } = {}) => {
  const prior = buildStructuredExpressionSection(section, { sections })
  // Applicability belongs to document presentation metadata, not business prose.
  // A specified diagram's own description is still visible and unchanged.
  const originals = new Map()
  for (const mapping of prior.trace.mappings.filter((item) => item.kind === 'QUALIFICATION_MAPPING')) {
    originals.set(mapping.source, [...new Set([...(originals.get(mapping.source) || []), mapping.original])])
  }
  const limits = new Map([...originals].map(([source, values]) => [source, sourceLimit(values)]))
  const bodyBlocks = []
  for (const block of prior.typedBlocks.body) {
    if (block.kind === 'GROUP' || (block.kind === 'DIAGRAM_STATUS'
      && !(prior.diagram.present && block.text.startsWith('Specified diagram:')))) continue
    bodyBlocks.push(block)
    if (block.kind === 'SOURCE_QUOTATION') {
      const limit = limits.get(block.source)
      if (!limit) invalid()
      bodyBlocks.push({ kind: 'SOURCE_LIMIT', source: block.source, text: `Source limit: ${limit}` })
    }
  }
  const qualificationBlocks = section.sectionKey === 'source-and-lineage-record' ? prior.typedBlocks.qualification : []
  return {
    heading: prior.heading, body: bodyBlocks.map(render).join('\n\n'),
    qualification: qualificationBlocks.map(render).join('\n\n'), diagram: prior.diagram,
    typedBlocks: { body: bodyBlocks, qualification: qualificationBlocks },
    trace: { ...prior.trace, profileVersion: OUTCOME_COMMERCIAL_EXPRESSION_PROFILE_VERSION,
      sourceProfileVersion: prior.trace.profileVersion, diagramApplicability: getCommercialDiagramApplicability(sections),
      localQualifications: [...limits].filter(([source]) => bodyBlocks.some((block) => block.kind === 'SOURCE_QUOTATION' && block.source === source))
        .map(([source, limit]) => ({ source, notes: [limit] })) },
  }
}
