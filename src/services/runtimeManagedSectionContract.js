import { validateReasoningArtefactDeclarations } from './reasoningArtefactContractService.js'

const text = (value) => String(value ?? '').trim()
const key = (value) => text(value).toLowerCase().replace(/-/g, '_')
const plain = (value) => value?.toObject ? value.toObject() : value
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const fail = (reason, message) => {
  const error = new Error(message)
  Object.assign(error, { status: 409, code: 'CONFLICT', reason, details: { reason } })
  throw error
}
const invalid = (message) => fail('RUNTIME_MANAGED_CONTRACT_INVALID', message)
export const isRuntimeManagedSection = (section) => section?.sectionMode === 'RUNTIME_MANAGED'
const sectionsOf = (pkg) => Array.isArray(pkg?.sections) ? pkg.sections.map(plain) : []
const unique = (values, normalize = text) => Array.isArray(values) && values.length > 0
  && values.length <= 100 && values.every((value) => typeof value === 'string' && normalize(value))
  && new Set(values.map(normalize)).size === values.length

// The package owns the relationship; presentation settings never declare proof.
export const validateRuntimeManagedSectionDeclarations = (frameworkPackage = {}) => {
  const sections = sectionsOf(frameworkPackage)
  if (sections.some((section) => section.runtimeManagedCompletion && !isRuntimeManagedSection(section))) {
    invalid('Only runtime-managed sections may declare internal completion sources.')
  }
  const managed = sections.filter(isRuntimeManagedSection)
  if (managed.length === 0) return []
  const artefacts = validateReasoningArtefactDeclarations({ frameworkPackage })
  for (const section of managed) {
    if (!/^framework_state\.sections\.[a-z][a-z0-9_]*$/.test(text(section.runtimePath))) {
      invalid('Runtime-managed sections require an exact section root path.')
    }
    if (sections.filter((item) => key(item.sectionKey) === key(section.sectionKey)
      || item.runtimePath === section.runtimePath).length !== 1) {
      invalid('Runtime-managed section identities and paths must be unique.')
    }
    const completion = plain(section.runtimeManagedCompletion)
    if (!completion && section.required !== true) continue
    if (!object(completion) || !unique(completion.sourceSectionKeys, key)
      || !unique(completion.reasoningArtefactKeys)) {
      invalid('Runtime-managed completion requires unique source sections and reasoning artefact keys.')
    }
    const sources = completion.sourceSectionKeys.map((sourceKey) => {
      const matches = sections.filter((item) => key(item.sectionKey) === key(sourceKey))
      if (matches.length !== 1 || isRuntimeManagedSection(matches[0])) {
        invalid('Internal completion sources must each resolve to one customer-guided package section.')
      }
      if (!/^framework_state\.sections\.[a-z][a-z0-9_]*$/.test(text(matches[0].runtimePath))) {
        invalid('Internal completion sources require exact section root paths.')
      }
      return matches[0]
    })
    const referenced = completion.reasoningArtefactKeys.map((artefactKey) => {
      const matches = artefacts.filter((item) => item.artefactKey === artefactKey)
      if (matches.length !== 1 || !matches[0].handoff.eligible
        || !sources.some((source) => matches[0].sectionKeys.some((id) => key(id) === key(source.sectionKey)))) {
        invalid('Each internal proof must name one handoff-eligible artefact belonging to a declared source.')
      }
      return matches[0]
    })
    if (sources.some((source) => !referenced.some((item) => item.sectionKeys.some((id) => key(id) === key(source.sectionKey))))) {
      invalid('Every internal completion source must supply a referenced proof artefact.')
    }
  }
  return managed
}

export const sourceSections = (pkg) => {
  const managed = validateRuntimeManagedSectionDeclarations(pkg)
  const sourceKeys = new Set(managed.flatMap((section) => section.runtimeManagedCompletion?.sourceSectionKeys || []).map(key))
  return sectionsOf(pkg).filter((section) => sourceKeys.has(key(section.sectionKey)))
}

export const assertCustomerSectionTarget = (section) => {
  if (isRuntimeManagedSection(section)) {
    fail('RUNTIME_MANAGED_CUSTOMER_WRITE_FORBIDDEN', 'This section is completed internally and does not accept customer input or acceptance.')
  }
}

export const assertRuntimeManagedCustomerWrite = ({ frameworkPackage, runtimePath }) => {
  const path = text(runtimePath)
  const managed = sectionsOf(frameworkPackage).filter(isRuntimeManagedSection)
  const sources = sourceSections(frameworkPackage)
  for (const section of [...managed, ...sources]) {
    const root = text(section.runtimePath)
    const related = root === path || root.startsWith(`${path}.`) || path.startsWith(`${root}.`)
    if (!related) continue
    // Exact guided roots are input-only through the existing root-write adapter.
    if (!isRuntimeManagedSection(section)
      && (path === root || path === `${root}.input` || path.startsWith(`${root}.input.`))) continue
    fail('RUNTIME_MANAGED_CUSTOMER_WRITE_FORBIDDEN', 'Internal completion proof and its source metadata cannot be written through customer input.')
  }
}
