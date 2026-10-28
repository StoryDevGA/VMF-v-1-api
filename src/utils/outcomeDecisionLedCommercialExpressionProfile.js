import { buildGovernedCommercialExpressionSection } from './outcomeGovernedCommercialExpressionProfile.js'

export const OUTCOME_COMMERCIAL_DECISION_LED_EXPRESSION_PROFILE_VERSION = 'outcome-commercial-expression.v4'

const fail = () => { throw new TypeError('Decision-led Commercial presentation cannot preserve the source qualification catalogue.') }
const mappings = expression => (expression.trace.mappings || []).filter(row => row.kind === 'QUALIFICATION_MAPPING')
const mappingKey = row => JSON.stringify([row.source, row.original])
const render = block => block.kind === 'LABEL' ? `**${block.text}**`
  : block.kind === 'SOURCE_QUOTATION' ? `> ${block.text}`
  : block.kind === 'INTAKE' ? `- ${block.text}` : block.text

// This recipe belongs to the selected Commercial profile. Source parsing,
// evidence interpretation and the historical v1-v3 recipes remain unchanged.
export const buildDecisionLedCommercialExpressionSection = (section, { sections = [] } = {}) => {
  const prior = buildGovernedCommercialExpressionSection(section, { sections })
  const explanation = prior.typedBlocks.body.find(block => block.kind === 'EXPLANATION')
  const sentence = explanation?.text.match(/^(.+?[.!?])(?:\s|$)/u)?.[1]
  if (!sentence || sentence.length > 255) fail()
  const remainder = explanation.text.slice(sentence.length).trimStart()
  const isCatalogue = section.sectionKey === 'source-and-lineage-record'
  const catalogueSection = sections.find(item => item.sectionKey === 'source-and-lineage-record')
  if (!catalogueSection) fail()
  const catalogue = isCatalogue ? prior : buildGovernedCommercialExpressionSection(catalogueSection, { sections })
  const catalogueMappings = new Set(mappings(catalogue).map(mappingKey))
  if (!catalogue.qualification.trim() || mappings(prior).some(row => !catalogueMappings.has(mappingKey(row)))) fail()
  const sources = [...new Set(prior.typedBlocks.body.filter(block => block.kind === 'SOURCE_QUOTATION').map(block => block.source))]
  if (sources.some(source => !source || !mappings(catalogue).some(row => row.source === source))) fail()
  const bodyBlocks = prior.typedBlocks.body.flatMap(block => {
    if (block.kind === 'SOURCE_LIMIT') return []
    if (block === explanation) return remainder ? [{ ...block, text: remainder }] : []
    return [{ ...block }]
  })
  const qualificationBlocks = isCatalogue ? prior.typedBlocks.qualification.map(block => ({ ...block }))
    : sources.length ? [{ kind: 'SCOPE', sources, text: `Quotation limits apply only to: ${sources.join('; ')}. Full source-specific provenance limits are recorded in the final section’s historical source notes. User-provided intake remains separate.` }]
    : prior.typedBlocks.body.some(block => block.kind === 'INTAKE')
      ? [{ kind: 'SCOPE', text: 'This section contains user-provided intake. Document provenance limits do not apply to that intake.' }] : []
  const body = bodyBlocks.map(render).join('\n\n')
  const qualification = isCatalogue ? prior.qualification : qualificationBlocks.map(render).join('\n\n')
  if (body.length > 24000 || qualification.length > 2000) fail()
  return { ...prior, heading: sentence, body, qualification,
    typedBlocks: { body: bodyBlocks, qualification: qualificationBlocks },
    trace: { ...prior.trace, sourceProfileVersion: prior.trace.profileVersion,
      profileVersion: OUTCOME_COMMERCIAL_DECISION_LED_EXPRESSION_PROFILE_VERSION,
      headingPlacement: { originalExplanation: explanation.text, heading: sentence, remainingExplanation: remainder },
      qualificationPresentation: { scope: sources, catalogueSectionKey: catalogueSection.sectionKey,
        catalogueMappingCount: catalogueMappings.size, sharedLimitsConsolidated: true } } }
}
