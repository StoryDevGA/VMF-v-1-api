import { createHash } from 'node:crypto'
import { parseProfessionalDocumentCandidateInput } from './professionalDocumentCandidateRenderer.js'
import { buildCanonicalJson } from './governanceAudit/checksumService.js'
import { CORRECTED_DOCX_INPUT_VERSION, assertCommercialDocxExpressionCorrection,
  correctedCommercialSectionHeading } from './commercialDocxExpressionCorrection.js'

export const DOCX_QUALIFICATION_POLICY = 'SOURCE_QUALIFICATION_CALLOUT_V1'
const version = 'source-qualification-callouts.v1'
const checksum = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
const same = (left, right) => buildCanonicalJson(left) === buildCanonicalJson(right)
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const need = value => {
  if (!value) throw Object.assign(new Error('The source qualification presentation is unavailable.'), {
    code: 'DOCX_QUALIFICATION_PRESENTATION_INVALID', status: 409,
    details: { reason: 'SOURCE_QUALIFICATION_BINDING_INVALID', contentIncludedInError: false },
  })
}

// Pure assembly over already supplied fields. The existing renderer parser has
// no model/source-read dependency; no application state is loaded here.
export const buildDocxSourceQualificationPresentation = input => {
  const source = input?.sourceEnvelope?.source, shaping = source?.content?.shaping
  const model = input?.model, visual = input?.selectedPacks?.VISUAL_SYSTEM
  need(['governed-private-docx-input.v1', CORRECTED_DOCX_INPUT_VERSION].includes(input?.contractVersion))
  const corrected = input.contractVersion === CORRECTED_DOCX_INPUT_VERSION
  if (corrected) assertCommercialDocxExpressionCorrection(input)
  need(model && Array.isArray(model.sections) && model.sections.length > 0
    && Array.isArray(shaping?.sections) && shaping.sections.length === model.sections.length
    && typeof model.title === 'string' && model.title === input.documentMetadata?.title
    && typeof input.markdown === 'string' && visual && same(visual, source.selectedPacks?.VISUAL_SYSTEM))
  for (const key of ['packId', 'versionId', 'contentHash']) need(typeof visual[key] === 'string' && visual[key].length > 0)
  need(/^sha256:[a-f0-9]{64}$/.test(visual.contentHash))
  const parse = markdown => parseProfessionalDocumentCandidateInput({ documentMetadata: input.documentMetadata, markdown }).parsed.blocks
  // The parser omits the matching document title; only body blocks have indices.
  const parts = [`# ${model.title}`], assembled = [], bindings = []
  model.sections.forEach((section, index) => {
    const original = shaping.sections[index], path = `shaping.sections[${index}]`
    need(section && original && section.key === original.sectionKey
      && section.heading === original.heading && (corrected || section.bodyMarkdown === original.body)
      && section.qualificationMarkdown === original.qualification
      && ['heading', 'body', 'qualification'].every(key => section.sourcePaths?.[key] === `${path}.${key}`)
      && [section.heading, section.bodyMarkdown, section.qualificationMarkdown].every(value => typeof value === 'string' && value.length > 0))
    const heading = corrected ? correctedCommercialSectionHeading(section, index) : `## ${section.heading}`
    parts.push(heading, section.bodyMarkdown, section.qualificationMarkdown)
    assembled.push(...parse(heading), ...parse(section.bodyMarkdown))
    const qualification = parse(section.qualificationMarkdown)
    need(qualification.length > 0 && qualification.every(block => ['paragraph', 'bullet'].includes(block.type)))
    qualification.forEach(block => {
      bindings.push({ blockIndex: assembled.length, sourcePath: `${path}.qualification`,
        sourceFieldChecksum: checksum(original.qualification), blockFingerprint: checksum(buildCanonicalJson(block)) })
      assembled.push(block)
    })
  })
  // Field boundaries can affect Markdown parsing. Do not assume independent
  // parses have the same positions as the actual complete document.
  need(parts.join('\n\n') === input.markdown && same(assembled, parse(input.markdown)))
  return { contractVersion: version, role: 'SOURCE_QUALIFICATION',
    visualSystem: { packId: visual.packId, versionId: visual.versionId, contentHash: visual.contentHash }, blocks: bindings }
}

export const assertDocxSourceQualificationPresentation = input => {
  const receipt = input?.presentation?.qualificationCallouts
  need(input?.renderer?.qualificationPolicy === DOCX_QUALIFICATION_POLICY
    && exact(receipt, ['contractVersion', 'role', 'visualSystem', 'blocks'])
    && exact(receipt.visualSystem, ['packId', 'versionId', 'contentHash']) && Array.isArray(receipt.blocks)
    && receipt.blocks.every(block => exact(block, ['blockIndex', 'sourcePath', 'sourceFieldChecksum', 'blockFingerprint'])
      && typeof block.blockIndex === 'number' && Number.isSafeInteger(block.blockIndex)))
  const expected = buildDocxSourceQualificationPresentation(input)
  need(same(receipt, expected))
  return expected.blocks.map(block => block.blockIndex)
}
