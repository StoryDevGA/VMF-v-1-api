import { OUTCOME_SELECTED_TARGET_CONTRACT_VERSION } from '../constants/outcomeSelectedTarget.js'
import { assertOutcomeSelectedDocumentPrivacy, assertOutcomeStudioProviderSafeValue } from './outcomeStudioProviderSafeContextService.js'

const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const fail = () => { throw new TypeError('Selected target provider context is invalid.') }
const nonempty = (value, max) => typeof value === 'string' && value.trim() && value.length <= max

export const assertOutcomeSelectedTargetProviderTarget = (value) => {
  if (!exact(value, ['contractVersion', 'documents', 'targetSections'])
    || value.contractVersion !== OUTCOME_SELECTED_TARGET_CONTRACT_VERSION
    || !exact(value.documents, ['outputType', 'schema'])
    || !exact(value.targetSections, ['required', 'optional'])
    || !Array.isArray(value.targetSections.required) || !value.targetSections.required.length
    || !Array.isArray(value.targetSections.optional)) fail()
  Object.values(value.documents).forEach((document) => {
    if (!nonempty(document, 40000)) fail()
    assertOutcomeSelectedDocumentPrivacy(document)
  })
  const sections = [...value.targetSections.required, ...value.targetSections.optional]
  if (sections.length > 20) fail()
  const keys = new Set()
  const headings = new Set()
  sections.forEach((section) => {
    if (!exact(section, ['targetSectionKey', 'heading', 'purpose'])
      || !/^[a-z0-9][a-z0-9._-]{0,139}$/.test(section.targetSectionKey)
      || !nonempty(section.heading, 255) || !nonempty(section.purpose, 2000)
      || keys.has(section.targetSectionKey) || headings.has(section.heading.toLowerCase())) fail()
    keys.add(section.targetSectionKey)
    headings.add(section.heading.toLowerCase())
    assertOutcomeStudioProviderSafeValue(section)
  })
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 85000) fail()
  return value
}

