import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { COMMERCIAL_OUTPUT_SECTION_KEYS } from '../utils/outcomeCommercialExpressionProfile.js'
import { PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE, PROFESSIONAL_DOCUMENT_LAYOUT_PROFILES,
  PROFESSIONAL_DOCUMENT_PRESENTATION_PROFILES } from './professionalDocumentCandidateRenderer.js'

export const APPROVED_EXPRESSION_VERSION = 'commercial-docx-approved-expression.v1'
export const APPROVED_DOCX_INPUT_VERSION = 'governed-private-docx-input.v3'
export const APPROVED_QUALIFICATION_POLICY = 'SOURCE_QUALIFICATION_PARAGRAPHS_V2'
export const APPROVED_EXPRESSION_RENDERER = Object.freeze({
  key: 'governed-source-private-docx', version: '0.1.4', format: 'DOCX', qualificationPolicy: APPROVED_QUALIFICATION_POLICY,
  layoutProfile: PROFESSIONAL_DOCUMENT_LAYOUT_PROFILES.ATTRIBUTED_QUOTATIONS,
  presentationProfile: PROFESSIONAL_DOCUMENT_PRESENTATION_PROFILES.CUSTOMER,
  engine: PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.engine,
  supportedComponents: Object.freeze(['HEADING', 'PARAGRAPH', 'LIST', 'TABLE', 'CALLOUT']),
  scope: 'PRIVATE_NON_AUTHORITATIVE_IN_MEMORY_ONLY',
})
export const APPROVED_EXPRESSION_FIXED = Object.freeze({
  actorUserId: '6a6c763dcace7a21bd41efa9', customerId: '6a6c75f2cace7a21bd41ef98',
  tenantId: '6a6c76e3cace7a21bd41eff9', runtimeInstanceId: '6ad715c91f39fea112115875',
  masterId: 'meaning_master_7f34d431-6640-482e-8695-75cd6f76883c',
  sourceFingerprint: '51cc8bf0b164db4e60438cb1559e62bf9a19b3cb2ebff4ffb0522f3ea57a9891',
  predecessorCandidateId: 'docx_candidate_7c552bd4-90e9-43f8-8305-d1d6cfbb0a0a',
  predecessorBodyFingerprint: '640c80cefea900edb60b491bb00dc8ef831c953c17b920de840b801a0f87a75a',
  failedReviewExecutionId: 'master_docx_result_0d396ab7333522a8893e2abf41a7347f33aca9a7',
  failedReviewResultFingerprint: '09b6e209cd29fcd368219afc57a191417dd1e4ef44f551ffd589ff98b8c6c315',
})
export const NARROW_EXPRESSION_VERSION = 'commercial-docx-approved-expression.v2'
export const NARROW_DOCX_INPUT_VERSION = 'governed-private-docx-input.v4'
export const NARROW_EXPRESSION_RENDERER = Object.freeze({ ...APPROVED_EXPRESSION_RENDERER, version: '0.1.5',
  layoutProfile: PROFESSIONAL_DOCUMENT_LAYOUT_PROFILES.SOURCE_SCOPED_QUOTATIONS })
export const NARROW_EXPRESSION_FIXED = Object.freeze({ ...APPROVED_EXPRESSION_FIXED,
  predecessorCandidateId: 'docx_candidate_c396012f-ebf6-4da0-b4e8-71580a359024',
  predecessorBodyFingerprint: 'f95736f9cb07513613bc957aaa267678f0ec6135252fb2752f8b266b8046a1b5',
  failedReviewExecutionId: 'master_docx_result_e48bc46a3945d8cf1beb9e8f81122f976f10ad97',
  failedReviewResultFingerprint: '8786c37149698a90b905916a871bcc590a3e285dcce2d8c5fc427336b0fa2167',
})
export const APPROVED_SECTION13_BOUNDARY = 'The supplied source does not establish a next permitted operational action or an execution approver.'
export const APPROVED_SECTION13_ROLE = 'Next legal downstream action'
export const APPROVED_SECTION13_STATE = 'DESCRIPTIVE_NO_OPERATIONAL_AUTHORITY_CONTROLLED_TEST_ONLY'
const textSource = 'ss044-synthetic-pilot-r1.txt', captureSource = 'controlled-synthetic-source-capture.docx'
const clone = value => JSON.parse(JSON.stringify(value))
const same = (a, b) => membershipHash(a) === membershipHash(b)
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
export const approvedExpressionNeed = (condition, reason) => {
  if (!condition) throw Object.assign(new Error('The approved private document correction is unavailable.'), {
    code: 'APPROVED_DOCX_CORRECTION_BLOCKED', status: 409, details: { reason, dispatchAvailable: false, finalisationAvailable: false },
  })
}
const need = approvedExpressionNeed
const profiles = Object.freeze({
  [APPROVED_EXPRESSION_VERSION]: Object.freeze({ version: APPROVED_EXPRESSION_VERSION, inputVersion: APPROVED_DOCX_INPUT_VERSION,
    modelVersion: 'private-document-content.v3', documentVersion: 3, renderer: APPROVED_EXPRESSION_RENDERER, fixed: APPROVED_EXPRESSION_FIXED }),
  [NARROW_EXPRESSION_VERSION]: Object.freeze({ version: NARROW_EXPRESSION_VERSION, inputVersion: NARROW_DOCX_INPUT_VERSION,
    modelVersion: 'private-document-content.v4', documentVersion: 4, renderer: NARROW_EXPRESSION_RENDERER, fixed: NARROW_EXPRESSION_FIXED }),
})
export const approvedExpressionProfile = version => {
  need(typeof version === 'string' && Object.hasOwn(profiles, version), 'APPROVED_PROFILE_VERSION')
  return profiles[version]
}
const forms = Object.freeze([
  ['Claim effective date, real-world currentness and measurement window are not established; capture/upload metadata is not an effective claim date.', null],
  ['Current R2 contradiction candidate contradiction_8d1dc05d4ca9 is UNREVIEWED. These qualifications do not adjudicate it or inherit the exact R1 formal finding.',
    'The cited source revision records the contradiction as unreviewed. These qualifications do not adjudicate it or carry forward the earlier formal finding.'],
  ['Disposable synthetic test only; this is not a customer case or evidence of real-world operations.', null],
  ['Legacy text-source location is supported only by the external frozen ledger text match; no native capture span receipt exists.', null],
  ['R1 fictional scenario reused unchanged in R2; no R2 changed-support delta is admitted. Repeated documents share authored synthetic provenance and are not independent corroboration.',
    'The fictional scenario is reused unchanged in the later source revision; no new supporting-evidence change is admitted in that revision. Repeated documents share authored synthetic provenance and are not independent corroboration.'],
  ['SOURCE_PRESENTED exact statement only. Native ACCEPTED and extraction VALIDATED statuses do not establish authenticity, independent verification, corroboration or business truth.',
    'Only the exact source-presented statement is supported. Application acceptance and extraction validation do not establish authenticity, independent verification, corroboration or business truth.'],
])

// Deliberately limited to the exact source approved by the user. This is not a
// general rewrite policy or an ARL/meaning approval of arbitrary source prose.
export const buildApprovedQualificationMapping = envelope => {
  const source = envelope?.source, fixed = APPROVED_EXPRESSION_FIXED
  need(envelope?.sourceFingerprint === fixed.sourceFingerprint && membershipHash(source) === fixed.sourceFingerprint,
    'APPROVED_SOURCE_CHANGED')
  need(['customerId', 'tenantId', 'runtimeInstanceId'].every(key => source.scope?.[key] === fixed[key])
    && source.scope.authoritative === false && source.scope.classification === 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST', 'APPROVED_SCOPE_CHANGED')
  const sections = source.content?.workingDraft?.sections
  need(sections?.length === 14 && source.content?.shaping?.expressionProfileVersion === 'outcome-commercial-expression.v4'
    && sections.every((s, i) => s.sectionKey === COMMERCIAL_OUTPUT_SECTION_KEYS[i]), 'APPROVED_SOURCE_STRUCTURE')
  const catalogue = sections[13].content
  const blocks = [...catalogue.matchAll(/Document qualifications (\d+) — Customer Document: ([^\n]+) \(verbatim; applies only to quotations marked with this entry\):\n\n([\s\S]*?)(?=\n\nDocument qualifications|$)/g)]
  need(blocks.length === 2 && blocks[0][2] === textSource && blocks[1][2] === captureSource, 'APPROVED_CATALOGUE_CHANGED')
  const mappings = blocks.flatMap((block, index) => {
    const expected = forms.filter((_form, i) => index === 0 || i !== 3)
    const clauses = [...block[3].matchAll(/^> (.+)$/gm)].map(match => match[1])
    need(same(clauses, expected.map(form => form[0])), 'APPROVED_CLAUSES_CHANGED')
    return clauses.map((original, i) => ({ source: block[2], originalCatalogue: block[1], perSourceOrder: i + 1,
      sourcePath: `workingDraft.sections[13].content`, original, customerExpression: expected[i][1] || original }))
  })
  need(mappings.length === 11, 'APPROVED_MAPPING_INCOMPLETE')
  return mappings
}
export const approvedQualificationMappingFingerprint = envelope => membershipHash(buildApprovedQualificationMapping(envelope))
export const assertApprovedCompatibilityReference = reference => {
  need(exact(reference, ['version', 'auditId', 'decisionFingerprint', 'sourceFingerprint', 'mappingFingerprint',
    'masterId', 'predecessorCandidateId', 'failedReviewExecutionId', 'failedReviewResultFingerprint', 'section13State'])
    && [APPROVED_EXPRESSION_VERSION, NARROW_EXPRESSION_VERSION].includes(reference.version)
    && typeof reference.auditId === 'string' && /^[a-f0-9]{24}$/.test(reference.auditId)
    && ['decisionFingerprint', 'sourceFingerprint', 'mappingFingerprint'].every(key => digest(reference[key]))
    && reference.section13State === APPROVED_SECTION13_STATE, 'APPROVED_COMPATIBILITY_REFERENCE')
  const fixed = approvedExpressionProfile(reference.version).fixed
  need(['sourceFingerprint', 'masterId', 'predecessorCandidateId', 'failedReviewExecutionId', 'failedReviewResultFingerprint']
      .every(key => reference[key] === fixed[key]), 'APPROVED_COMPATIBILITY_REFERENCE')
  return reference
}
const source13 = source => {
  const section = source.content.workingDraft.sections[12]
  const parts = section.content.split('\n\n'), opening = parts[0], closing = parts.at(-1)
  const quotes = [...section.content.matchAll(/Document statement from Customer Document: ([^\n]+?) \(document qualifications [12] in Source and lineage record\):\n\n> ([^\n]+)/g)]
  need(section.title === 'Recorded question and review context' && quotes.length === 3
    && opening.includes('does not prescribe an approval route') && closing.includes('This paper assigns no such authority and adopts no decision.'),
  'APPROVED_SECTION13_SOURCE')
  const labels = ['Question under consideration', 'Outstanding access review, from its own source', 'Source statement about permission']
  const body = [opening, APPROVED_SECTION13_BOUNDARY, ...quotes.flatMap((quote, i) => [
    `**${labels[i]}**`, `**Source: ${quote[1]}**`, `> ${quote[2]}`,
  ]), closing].join('\n\n')
  return { subtitle: section.title, body }
}
const approvedSections = (source, mapping) => source.content.shaping.sections.map((original, index) => {
  const roleLabel = index === 12 ? APPROVED_SECTION13_ROLE : source.content.workingDraft.sections[index].title
  let bodyMarkdown = original.body, subtitle
  if (index === 12) { const s = source13(source); bodyMarkdown = s.body; subtitle = s.subtitle }
  let qualificationMarkdown = original.qualification
  if (index > 0 && index < 13) {
    const sources = [...new Set([...bodyMarkdown.matchAll(/^\*\*Source: ([^\n]+)\*\*$/gm)].map(match => match[1]))]
    need(sources.length > 0 && sources.every(s => [textSource, captureSource].includes(s)), 'APPROVED_LOCAL_SOURCE')
    // Exact approved restrictions, with source-specific applicability. The full
    // genuinely shared catalogue remains in role14; unique locator stays local.
    const local = [forms[2][0], ...(sources.includes(textSource) ? [forms[3][0]] : [])]
    qualificationMarkdown = `**Source qualifications — ${sources.join('; ')}**\n\n${local.join('\n\n')}\n\nFull source-specific qualifications: section 14. These limits apply to the source quotations, not to user-provided intake.`
  }
  if (index === 13) {
    const common = mapping.filter(m => m.source === captureSource).map(m => `- ${m.customerExpression}`)
    qualificationMarkdown = `**Source qualifications**\n\nThese limits apply only to quotations from the named source, not to user-provided intake.\n\n**Quotations from ${textSource}; ${captureSource}**\n\n${common.join('\n\n')}\n\n**Additional restriction for quotations from ${textSource} only**\n\n- ${forms[3][0]}`
  }
  return { key: original.sectionKey, roleLabel, heading: original.heading, ...(subtitle ? { subtitle } : {}),
    bodyMarkdown, qualificationMarkdown, truthReferences: clone(original.truthReferences),
    sourcePaths: { heading: `shaping.sections[${index}].heading`, body: index === 12 ? 'workingDraft.sections[12].content' : `shaping.sections[${index}].body`,
      qualification: index === 0 ? 'shaping.sections[0].qualification' : 'workingDraft.sections[13].content' } }
})
const narrowSections = (source, mapping) => approvedSections(source, mapping).map((section, index) => {
  if (index === 0) return { ...section,
    qualificationMarkdown: 'This section records separately supplied user intake, not independent document evidence. Its inclusion does not establish historical author identity, authenticity, independence or real customer provenance.',
    sourcePaths: { ...section.sourcePaths, qualification: 'workingDraft.sections[0]' } }
  if (index === 13) return { ...section, qualificationMarkdown: section.qualificationMarkdown.replace(
    'These limits apply only to quotations from the named source, not to user-provided intake.',
    'The following entries qualify quotations from the named sources. User-provided intake is recorded separately and retains its own provenance limits.') }
  const sources = [...new Set([...section.bodyMarkdown.matchAll(/^\*\*Source: ([^\n]+)\*\*$/gm)].map(match => match[1]))]
  need(sources.length > 0 && sources.every(s => [textSource, captureSource].includes(s)), 'APPROVED_LOCAL_SOURCE')
  return { ...section, qualificationMarkdown: [
    `${forms[2][0]} Full source-specific quotation qualifications: section 14.`,
    ...(sources.includes(textSource) ? [`**Additional restriction — quotations from ${textSource} only**`, forms[3][0]] : []),
  ].join('\n\n') }
})
const profileSections = (source, mapping, profile) => profile.version === NARROW_EXPRESSION_VERSION
  ? narrowSections(source, mapping) : approvedSections(source, mapping)
const markdown = (title, sections) => [`# ${title}`, ...sections.flatMap((s, i) => [
  `# ${i + 1}. ${s.roleLabel}`, `## ${s.subtitle || s.heading}`, ...(s.subtitle ? [s.heading] : []), s.bodyMarkdown, s.qualificationMarkdown,
])].join('\n\n')
export const applyApprovedCommercialExpression = (input, reference) => {
  assertApprovedCompatibilityReference(reference)
  need(input?.contractVersion === 'governed-private-docx-input.v1', 'APPROVED_BASE_INPUT')
  const profile = approvedExpressionProfile(reference.version), mapping = buildApprovedQualificationMapping(input.sourceEnvelope)
  need(reference.mappingFingerprint === membershipHash(mapping), 'APPROVED_MAPPING_CHANGED')
  const result = clone(input), sections = profileSections(result.sourceEnvelope.source, mapping, profile)
  result.contractVersion = profile.inputVersion
  result.model = { modelVersion: profile.modelVersion, title: input.model.title, sections }
  result.documentMetadata.versionNumber = profile.documentVersion
  result.profile.expressionProfileVersion = profile.version
  result.expressionCorrection = { contractVersion: profile.version, compatibilityReference: clone(reference) }
  result.presentation.approvedQualificationMapping = { policyVersion: profile.version,
    mappingFingerprint: membershipHash(mapping), literalCatalogueLocation: 'IMMUTABLE_SOURCE_RECORD', customerCatalogueVerbatim: false,
    mappings: mapping, section13State: APPROVED_SECTION13_STATE }
  delete result.presentation.qualificationCallouts
  if (profile.version === APPROVED_EXPRESSION_VERSION) {
    result.renderer.version = '0.1.4'; result.renderer.qualificationPolicy = APPROVED_QUALIFICATION_POLICY
  } else result.renderer = clone(profile.renderer)
  result.markdown = markdown(result.model.title, sections)
  return result
}
export const assertApprovedCommercialExpression = input => {
  need(exact(input, ['contractVersion', 'model', 'documentMetadata', 'markdown', 'presentation', 'sourceEnvelope', 'selectedPacks',
    'profile', 'documentReceipts', 'styleEligibility', 'visualConformance', 'renderer', 'expressionCorrection'])
    && [APPROVED_DOCX_INPUT_VERSION, NARROW_DOCX_INPUT_VERSION].includes(input.contractVersion)
    && !Object.hasOwn(input.presentation || {}, 'qualificationCallouts'), 'APPROVED_INPUT_VERSION')
  const reference = assertApprovedCompatibilityReference(input.expressionCorrection?.compatibilityReference)
  const profile = approvedExpressionProfile(reference.version)
  need(input.contractVersion === profile.inputVersion && same(input.renderer, profile.renderer), 'APPROVED_INPUT_VERSION')
  need(exact(input.expressionCorrection, ['contractVersion', 'compatibilityReference'])
    && input.expressionCorrection.contractVersion === profile.version, 'APPROVED_EXPRESSION_REFERENCE')
  const mapping = buildApprovedQualificationMapping(input.sourceEnvelope), sections = profileSections(input.sourceEnvelope.source, mapping, profile)
  need(reference.mappingFingerprint === membershipHash(mapping)
    && same(input.model, { modelVersion: profile.modelVersion, title: input.sourceEnvelope.source.selectedPacks.OUTPUT_TYPE.label, sections })
    && same(input.selectedPacks, input.sourceEnvelope.source.selectedPacks)
    && input.profile.key === 'commercial-strategy-and-decision-paper' && input.profile.expressionProfileVersion === profile.version
    && input.documentMetadata.versionNumber === profile.documentVersion && input.documentMetadata.status === 'PRIVATE_UNREVIEWED'
    && input.documentMetadata.title === input.model.title && input.markdown === markdown(input.model.title, sections)
    && exact(input.presentation, ['titleRule', 'titleSourcePath', 'originalSourceTitle', 'approvedQualificationMapping'])
    && same(input.presentation.approvedQualificationMapping, { policyVersion: profile.version,
      mappingFingerprint: membershipHash(mapping), literalCatalogueLocation: 'IMMUTABLE_SOURCE_RECORD', customerCatalogueVerbatim: false,
      mappings: mapping, section13State: APPROVED_SECTION13_STATE }), 'APPROVED_EXPRESSION_CHANGED')
  return reference
}
