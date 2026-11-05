import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { COMMERCIAL_OUTPUT_SECTION_KEYS } from '../utils/outcomeCommercialExpressionProfile.js'

export const COMMERCIAL_DOCX_CORRECTION_VERSION = 'commercial-docx-expression-correction.v1'
export const CORRECTED_DOCX_INPUT_VERSION = 'governed-private-docx-input.v2'
const sourceProfile = 'outcome-commercial-expression.v4'
const compressedBoundary = 'They do not assign an execution approver, define an approval procedure, adopt a decision or grant permission after review.'
const fullBoundary = 'These three quoted statements must not be read as assigning an execution approver, defining an approval procedure, or granting permission after review. This is descriptive organisation of the recorded question and outstanding review, not an adopted approval process. This paper assigns no such authority and adopts no decision.'
const clone = value => JSON.parse(JSON.stringify(value))
const same = (a, b) => membershipHash(a) === membershipHash(b)
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const need = value => {
  if (!value) throw Object.assign(new Error('The private Commercial expression correction is unavailable.'), {
    code: 'COMMERCIAL_DOCX_CORRECTION_BLOCKED', status: 409,
    details: { reason: 'CORRECTION_SOURCE_OR_BINDING_CHANGED', contentIncludedInError: false },
  })
}

// References identify the failed predecessor, never authenticate its receipt or
// grant review authority. A future storage owner must verify the actual records.
const assertPredecessor = value => {
  need(exact(value, ['candidateId', 'inputFingerprint', 'outputChecksum', 'failedReviewExecutionId', 'failedReviewResultFingerprint'])
    && Object.values(value).every(field => typeof field === 'string')
    && /^docx_candidate_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.candidateId)
    && /^[a-f0-9]{64}$/.test(value.inputFingerprint)
    && /^sha256:[a-f0-9]{64}$/.test(value.outputChecksum)
    && /^master_docx_result_[a-f0-9]{40}$/.test(value.failedReviewExecutionId)
    && /^[a-f0-9]{64}$/.test(value.failedReviewResultFingerprint))
}

const sectionsFromSource = source => {
  const shaping = source?.content?.shaping, draft = source?.content?.workingDraft
  need(shaping?.expressionProfileVersion === sourceProfile
    && shaping.outputContract?.outputTypeKey === 'commercial-strategy-and-decision-paper'
    && same(shaping.outputContract.sections, COMMERCIAL_OUTPUT_SECTION_KEYS)
    && shaping.sections?.length === 14 && draft?.sections?.length === 14)
  return shaping.sections.map((section, index) => {
    const original = draft.sections[index], path = `shaping.sections[${index}]`
    need(section.sectionKey === COMMERCIAL_OUTPUT_SECTION_KEYS[index] && original.sectionKey === section.sectionKey
      && typeof original.title === 'string' && original.title.length > 0 && original.title.length <= 200
      && original.title === original.title.trim() && !/[#*_`[\]<>\\]/.test(original.title)
      && [...original.title].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127))
    let bodyMarkdown = section.body
    if (index === 12) {
      need(original.title === 'Recorded question and review context'
        && typeof original.content === 'string'
        && original.content.split('\n\n').filter(part => part === fullBoundary).length === 1
        && typeof bodyMarkdown === 'string' && bodyMarkdown.startsWith(`${compressedBoundary}\n\n`))
      bodyMarkdown = `${bodyMarkdown.slice(compressedBoundary.length + 2)}\n\n${fullBoundary}`
    }
    return { key: section.sectionKey, heading: section.heading, bodyMarkdown,
      qualificationMarkdown: section.qualification,
      sourcePaths: { heading: `${path}.heading`, body: `${path}.body`, qualification: `${path}.qualification` },
      truthReferences: clone(section.truthReferences), roleLabel: original.title,
      roleSourcePath: `workingDraft.sections[${index}].title`,
      ...(index === 12 ? { restoredParagraphSourcePath: 'workingDraft.sections[12].content' } : {}) }
  })
}
export const correctedCommercialSectionHeading = (section, index) => `# ${index + 1}. ${section.roleLabel}\n\n## ${section.heading}`
const markdownFor = (title, sections) => [`# ${title}`, ...sections.flatMap((section, index) => [
  correctedCommercialSectionHeading(section, index), section.bodyMarkdown, section.qualificationMarkdown,
])].join('\n\n')

export const applyCommercialDocxExpressionCorrection = (legacyInput, predecessor) => {
  need(legacyInput?.contractVersion === 'governed-private-docx-input.v1')
  assertPredecessor(predecessor)
  const input = clone(legacyInput), sections = sectionsFromSource(input.sourceEnvelope?.source)
  input.contractVersion = CORRECTED_DOCX_INPUT_VERSION
  input.expressionCorrection = { contractVersion: COMMERCIAL_DOCX_CORRECTION_VERSION, predecessor: clone(predecessor) }
  input.profile = { key: legacyInput.profile.key, expressionProfileVersion: COMMERCIAL_DOCX_CORRECTION_VERSION,
    sourceExpressionProfileVersion: sourceProfile }
  input.model = { modelVersion: 'private-document-content.v2', title: input.model.title, sections }
  input.documentMetadata.versionNumber = 2
  input.markdown = markdownFor(input.model.title, sections)
  return input
}

// Reconstruct the entire permitted presentation, so recomputing an outer hash
// cannot admit arbitrary changed text, role labels or source qualifications.
export const assertCommercialDocxExpressionCorrection = input => {
  need(input?.contractVersion === CORRECTED_DOCX_INPUT_VERSION
    && exact(input.expressionCorrection, ['contractVersion', 'predecessor'])
    && input.expressionCorrection.contractVersion === COMMERCIAL_DOCX_CORRECTION_VERSION)
  assertPredecessor(input.expressionCorrection.predecessor)
  const source = input.sourceEnvelope?.source, sections = sectionsFromSource(source)
  need(membershipHash(source) === input.sourceEnvelope.sourceFingerprint
    && same(input.profile, { key: 'commercial-strategy-and-decision-paper',
      expressionProfileVersion: COMMERCIAL_DOCX_CORRECTION_VERSION, sourceExpressionProfileVersion: sourceProfile })
    && same(input.model, { modelVersion: 'private-document-content.v2', title: source.selectedPacks.OUTPUT_TYPE.label, sections })
    && input.documentMetadata?.title === input.model.title && input.documentMetadata.versionNumber === 2
    && input.documentMetadata.status === 'PRIVATE_UNREVIEWED'
    && input.markdown === markdownFor(input.model.title, sections))
  return sections
}
