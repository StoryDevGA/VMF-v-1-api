import {
  getRuntimeSectionInput,
  hashSectionInput,
} from './runtimeSectionModelService.js'
import {
  buildReasoningArtefactOutputs,
  validateReasoningArtefactDeclarations,
} from './reasoningArtefactContractService.js'

import { isRuntimeManagedSection, validateRuntimeManagedSectionDeclarations, sourceSections } from './runtimeManagedSectionContract.js'
export { isRuntimeManagedSection, validateRuntimeManagedSectionDeclarations, assertCustomerSectionTarget, assertRuntimeManagedCustomerWrite } from './runtimeManagedSectionContract.js'
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
const sectionsOf = (pkg) => Array.isArray(pkg?.sections) ? pkg.sections.map(plain) : []
const stateKey = (section) => text(section.runtimePath).split('.').at(-1)
const sectionValue = (state, section) => state?.sections?.[stateKey(section)]

const packageContext = (pkg) => ({
  packageKey: pkg.packageKey,
  version: pkg.version,
  sections: sectionsOf(pkg).map((section) => ({
    sectionKey: section.sectionKey, runtimePath: section.runtimePath, required: section.required,
    sectionMode: section.sectionMode, runtimeRole: section.runtimeRole,
    runtimeManagedCompletion: plain(section.runtimeManagedCompletion),
    dependsOnSectionKeys: section.dependsOnSectionKeys,
    validationKeys: section.validationKeys,
  })),
  reasoningArtefacts: (pkg.reasoningArtefacts || []).map(plain),
  workflowBindings: (pkg.workflowBindings || []).map(plain),
  dependencySnapshotId: pkg.dependencyLock?.snapshotId,
  dependencySnapshotHash: pkg.dependencyLock?.snapshotHash,
})

const dependencyKeys = (section) => section.dependsOnSectionKeys || section.dependencySectionKeys || section.dependsOn || []
const sourceContext = ({ frameworkPackage, frameworkState, section, input }) => {
  const evidence = frameworkState?.evidence_pack || {}
  if (evidence.accepted !== true || !Number.isFinite(Date.parse(evidence.acceptedAt))
    || evidence.needsRefresh === true || evidence.needs_refresh === true) {
    fail('RUNTIME_MANAGED_EVIDENCE_NOT_CURRENT', 'Accept current Intelligence Hub evidence before deriving internal completion.')
  }
  if (!text(frameworkPackage.packageKey) || !text(frameworkPackage.version)
    || !text(frameworkPackage.dependencyLock?.snapshotId) || !text(frameworkPackage.dependencyLock?.snapshotHash)) {
    fail('RUNTIME_MANAGED_PACKAGE_PROOF_MISSING', 'Internal completion requires the package identity and locked dependency snapshot.')
  }
  const state = sectionValue(frameworkState, section) || {}
  const additionalEvidence = Array.isArray(state.additionalEvidence)
    ? state.additionalEvidence
    : (state.additionalEvidence && typeof state.additionalEvidence === 'object'
        && Object.keys(state.additionalEvidence).length > 0
      ? state.additionalEvidence
      : [])
  const dependencies = dependencyKeys(section).map((id) => {
    const matches = sectionsOf(frameworkPackage).filter((candidate) => key(candidate.sectionKey) === key(id))
    if (matches.length !== 1 || isRuntimeManagedSection(matches[0])) invalid('Internal proof has an unresolved or cyclic source dependency.')
    const dependency = sectionValue(frameworkState, matches[0]) || {}
    const accepted = dependency.accepted
    if (!accepted?.truthHash || dependency.review?.status !== 'ACCEPTED' || dependency.state?.needsRegeneration === true
      || !dependency.generated || accepted.sourceGeneratedAt !== dependency.generated.generatedAt
      || accepted.inputHash !== hashSectionInput(getRuntimeSectionInput(dependency))) {
      fail('RUNTIME_MANAGED_SOURCE_STALE', 'An upstream source is missing current accepted truth. Regenerate and accept the affected guided section.')
    }
    return { sectionKey: matches[0].sectionKey, truthHash: accepted.truthHash, content: accepted.content,
      acceptedAt: accepted.acceptedAt, inputHash: accepted.inputHash, sourceGeneratedAt: accepted.sourceGeneratedAt }
  })
  return {
    package: packageContext(frameworkPackage),
    inputHash: hashSectionInput(input === undefined ? getRuntimeSectionInput(state) : input),
    dependencies,
    sectionEvidence: { additionalEvidence, evidenceObjects: Array.isArray(state.evidenceObjects) ? state.evidenceObjects : [] },
    // Governed review clears acceptance; reacceptance advances acceptedAt. This
    // boundary is also available to bounded renderer reads without bulk evidence.
    evidence: { accepted: evidence.accepted, acceptedAt: evidence.acceptedAt,
      refreshedAt: evidence.refreshedAt || null, inputs: evidence.inputs || {} },
  }
}

const sourceOutput = (generated = {}) => ({
  content: generated.content, generatedAt: generated.generatedAt, inputHash: generated.inputHash,
  evidenceHash: generated.evidenceHash, dependencyHash: generated.dependencyHash,
  sectionContractHash: generated.generator?.sectionContractHash,
  reasoningArtefacts: generated.reasoningArtefacts,
  reasoningArtefactReceipts: generated.reasoningArtefactReceipts,
})

export const buildRuntimeManagedSourceReceipt = ({ frameworkPackage, frameworkState, section, generated, input } = {}) => {
  if (!sourceSections(frameworkPackage).some((source) => key(source.sectionKey) === key(section.sectionKey))) return null
  return {
    contractVersion: 'runtime-managed-source.v1', sectionKey: section.sectionKey, runtimePath: section.runtimePath,
    contextHash: hashSectionInput(sourceContext({ frameworkPackage, frameworkState, section, input })),
    outputHash: hashSectionInput(sourceOutput(generated)),
  }
}

export const evaluateRuntimeManagedSections = ({ frameworkPackage, frameworkState, now = new Date().toISOString() } = {}) => {
  const blockers = []
  const receipts = []
  let managed = sectionsOf(frameworkPackage).filter(isRuntimeManagedSection)
  try { managed = validateRuntimeManagedSectionDeclarations(frameworkPackage) } catch (error) {
    return { requiredSectionCount: managed.length, readySectionCount: 0, receipts, blockers: [{ state: error.reason, reason: error.message }] }
  }
  const required = managed.filter((section) => section.required === true || section.runtimeManagedCompletion)
  for (const section of required) {
    try {
      const completion = section.runtimeManagedCompletion
      const sources = []
      for (const sourceKey of completion.sourceSectionKeys) {
        const source = sectionsOf(frameworkPackage).find((item) => key(item.sectionKey) === key(sourceKey))
        const value = sectionValue(frameworkState, source) || {}
        const { generated, accepted } = value
        if (!generated || !accepted?.truthHash || value.review?.status !== 'ACCEPTED' || value.state?.needsRegeneration === true
          || (Date.parse(value.review?.invalidatedAt) > Date.parse(accepted.acceptedAt))
          || accepted.sourceGeneratedAt !== generated.generatedAt
          || accepted.inputHash !== hashSectionInput(getRuntimeSectionInput(value))
          || hashSectionInput(accepted.content) !== hashSectionInput(generated.content)) {
          fail('RUNTIME_MANAGED_SOURCE_STALE', 'Internal completion requires current generated and accepted guided-source truth.')
        }
        const actual = generated.runtimeManagedSourceReceipt
        if (!object(actual)) fail('RUNTIME_MANAGED_PROOF_MISSING', 'Internal source proof is missing. Regenerate and accept the source guided section.')
        const expected = buildRuntimeManagedSourceReceipt({ frameworkPackage, frameworkState, section: source, generated })
        if (hashSectionInput(actual) !== hashSectionInput(expected)) {
          fail('RUNTIME_MANAGED_PROOF_STALE', 'Internal source proof no longer matches current inputs, evidence, dependencies or package. Regenerate and accept its source.')
        }
        const declarations = validateReasoningArtefactDeclarations({ frameworkPackage })
          .filter((item) => completion.reasoningArtefactKeys.includes(item.artefactKey)
            && item.sectionKeys.some((id) => key(id) === key(source.sectionKey)))
        const rebuilt = buildReasoningArtefactOutputs({ candidate: generated,
          declarations: declarations.map((item) => ({ ...item, required: true })),
          packageKey: frameworkPackage.packageKey, packageVersion: frameworkPackage.version,
          sectionKey: source.sectionKey, stateSectionKey: stateKey(source),
          inputHash: generated.inputHash, evidenceHash: generated.evidenceHash,
          dependencyHash: generated.dependencyHash, sectionContractHash: generated.generator?.sectionContractHash,
          generatedAt: generated.generatedAt, now,
        })
        for (const declaration of declarations) {
          const artefactKey = declaration.artefactKey
          const existing = generated.reasoningArtefactReceipts
          if (!object(existing) || Object.values(existing).filter((item) => item?.artefactKey === artefactKey).length !== 1) {
            fail('RUNTIME_MANAGED_PROOF_DUPLICATED', 'Internal proof receipts must resolve exactly once per artefact.')
          }
          const acceptedReceipts = accepted.reasoningArtefactReceipts
          if (!object(acceptedReceipts) || Object.values(acceptedReceipts).filter((item) => item?.artefactKey === artefactKey).length !== 1) {
            fail('RUNTIME_MANAGED_PROOF_DUPLICATED', 'Accepted internal proof receipts must resolve exactly once per artefact.')
          }
          // Validate using the original declaration (including its authored required flag).
          const original = buildReasoningArtefactOutputs({ candidate: generated, declarations: [declaration],
            packageKey: frameworkPackage.packageKey, packageVersion: frameworkPackage.version,
            sectionKey: source.sectionKey, stateSectionKey: stateKey(source), inputHash: generated.inputHash,
            evidenceHash: generated.evidenceHash, dependencyHash: generated.dependencyHash,
            sectionContractHash: generated.generator?.sectionContractHash, generatedAt: generated.generatedAt, now })
          if (hashSectionInput(existing[artefactKey]) !== hashSectionInput(original.receipts[artefactKey])
            || hashSectionInput(accepted.reasoningArtefactReceipts?.[artefactKey]) !== hashSectionInput(existing[artefactKey])
            || hashSectionInput(accepted.reasoningArtefacts?.[artefactKey]) !== hashSectionInput(rebuilt.values[artefactKey])) {
            fail('RUNTIME_MANAGED_PROOF_INCOMPATIBLE', 'Internal proof must match the current declaration and accepted source artefact.')
          }
        }
        sources.push({ sectionKey: source.sectionKey, truthHash: accepted.truthHash,
          sourceReceipt: actual, artefactHashes: Object.fromEntries(Object.entries(rebuilt.values).map(([id, value]) => [id, hashSectionInput(value)])) })
      }
      const receipt = { contractVersion: 'runtime-managed-completion.v1', sectionKey: section.sectionKey,
        runtimePath: section.runtimePath, declarationHash: hashSectionInput(section), sources }
      receipts.push({ ...receipt, receiptHash: hashSectionInput(receipt) })
    } catch (error) {
      blockers.push({ sectionKey: section.sectionKey, state: error.reason || 'RUNTIME_MANAGED_PROOF_INVALID', reason: error.message })
    }
  }
  return { requiredSectionCount: required.length, readySectionCount: receipts.length, receipts, blockers }
}
