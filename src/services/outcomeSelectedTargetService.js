import { assertOutcomeSelectedTargetProviderTarget } from './outcomeSelectedTargetProviderContextService.js'
import { OUTCOME_SELECTED_TARGET_CONTRACT_VERSION } from '../constants/outcomeSelectedTarget.js'
import { createHash } from 'node:crypto'
import { hashOutcomeShapingValue, projectOutcomeShapingContractIdentity } from '../utils/outcomeSelectedTargetIdentity.js'
import { assertOutcomeSelectedDocumentPrivacy } from './outcomeStudioProviderSafeContextService.js'

const fail = () => { throw Object.assign(new Error('Selected target contract is invalid or unavailable.'), { code: 'OUTCOME_SELECTED_TARGET_INVALID' }) }
const exact = (v, keys) => v && Object.getPrototypeOf(v) === Object.prototype && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))
const keyFor = (heading) => heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const itemsFrom = (document) => {
  const result = new Map()
  const block = document.match(/^## Required structure\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1] || ''
  const items = [...block.matchAll(/^\d+\.\s+\*\*([^*]+)\*\*\s*[—–-]\s*([\s\S]*?)(?=^\d+\.\s|$(?![\s\S]))/gm)]
  for (const item of items) {
    const heading = item[1].trim()
    if (result.has(heading)) fail()
    result.set(heading, item[2].replace(/\s+/g, ' ').trim())
  }
  return result
}
export const projectOutcomeSelectedTargetBinding = ({ contract }) => {
  const contractIdentity = projectOutcomeShapingContractIdentity(contract)
  const documents = { outputType: contract.outputType.content, schema: contract.schema.content }
  for (const key of ['outputType', 'schema']) {
    if (`sha256:${createHash('sha256').update(documents[key], 'utf8').digest('hex')}` !== contract[key].actualContentHash) fail()
  }
  Object.values(documents).forEach(assertOutcomeSelectedDocumentPrivacy)
  const purposes = itemsFrom(documents.schema)
  const keys = new Set()
  const targets = (headings) => headings.map(heading => {
    const targetSectionKey = keyFor(heading)
    if (!targetSectionKey || targetSectionKey.length > 140 || keys.has(targetSectionKey)) fail()
    keys.add(targetSectionKey)
    return { targetSectionKey, heading, purpose: purposes.get(heading) || heading }
  })
  const targetSections = { required: targets(contract.schemaProjection.requiredSections), optional: targets(contract.schemaProjection.optionalSections || []) }
  if (!targetSections.required.length || keys.size > 20) fail()
  const providerTarget = { contractVersion: OUTCOME_SELECTED_TARGET_CONTRACT_VERSION, documents, targetSections }
  assertOutcomeSelectedTargetProviderTarget(providerTarget)
  const receipt = { contractVersion: OUTCOME_SELECTED_TARGET_CONTRACT_VERSION, contractIdentity, targetSections,
    providerTargetFingerprint: hashOutcomeShapingValue(providerTarget) }
  return { providerTarget, receipt, receiptFingerprint: hashOutcomeShapingValue(receipt) }
}

export const assertOutcomeSelectedTargetSelection = (selection) => {
  if (!exact(selection, ['contractVersion', 'receipt', 'receiptFingerprint'])
    || selection.contractVersion !== OUTCOME_SELECTED_TARGET_CONTRACT_VERSION
    || !exact(selection.receipt, ['contractVersion', 'contractIdentity', 'targetSections', 'providerTargetFingerprint'])
    || selection.receipt.contractVersion !== OUTCOME_SELECTED_TARGET_CONTRACT_VERSION
    || !/^[a-f0-9]{64}$/.test(selection.receipt.providerTargetFingerprint || '')
    || selection.receiptFingerprint !== hashOutcomeShapingValue(selection.receipt)) fail()
  const identity = selection.receipt.contractIdentity
  if (!exact(identity, ['outputType', 'schema']) || hashOutcomeShapingValue(projectOutcomeShapingContractIdentity(identity)) !== hashOutcomeShapingValue(identity)) fail()
  const sections = selection.receipt.targetSections
  if (!exact(sections, ['required', 'optional']) || !Array.isArray(sections.required) || !sections.required.length || !Array.isArray(sections.optional)) fail()
  const all = [...sections.required, ...sections.optional]
  if (all.length > 20 || new Set(all.map(s => s.targetSectionKey)).size !== all.length
    || all.some(s => !exact(s, ['targetSectionKey', 'heading', 'purpose']) || typeof s.heading !== 'string' || !s.heading.trim() || s.heading.length > 255
      || s.targetSectionKey !== keyFor(s.heading) || !s.targetSectionKey || s.targetSectionKey.length > 140
      || typeof s.purpose !== 'string' || !s.purpose.trim() || s.purpose.length > 2000)) fail()
  return selection
}
