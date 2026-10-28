import { buildReadableCommercialExpressionSection } from './outcomeReadableCommercialExpressionProfile.js'

export const OUTCOME_COMMERCIAL_GOVERNED_EXPRESSION_PROFILE_VERSION = 'outcome-commercial-expression.v3'

// A new recipe keeps historical candidates reproducible. It changes presentation
// roles, never quotation text, source qualification mappings or business meaning.
const render = block => {
  if (block.kind === 'LABEL') return `**${block.text}**`
  if (block.kind === 'SOURCE_QUOTATION') return `> ${block.text}`
  if (block.kind === 'INTAKE') return `- ${block.text}`
  if (block.kind === 'SOURCE_LIMIT') return `> **Source note**\n> ${block.text.replaceAll('\n', '\n> ')}`
  return block.text
}

export const buildGovernedCommercialExpressionSection = (section, options = {}) => {
  const prior = buildReadableCommercialExpressionSection(section, options)
  const body = prior.typedBlocks.body.map(block => block.kind === 'SOURCE_LIMIT'
    ? { ...block, text: block.text.replace(/For (.*?) quotations only:/g, 'Applies to $1 quotations:') }
    : { ...block })
  const renderedBody = body.map(render).join('\n\n')
  if (renderedBody.length > 24000) throw new TypeError('Commercial presentation exceeds the existing section limit.')
  return { ...prior, body: renderedBody, typedBlocks: { ...prior.typedBlocks, body },
    trace: { ...prior.trace, sourceProfileVersion: prior.trace.profileVersion,
      profileVersion: OUTCOME_COMMERCIAL_GOVERNED_EXPRESSION_PROFILE_VERSION } }
}
