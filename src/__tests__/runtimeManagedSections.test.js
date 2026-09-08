import { describe, expect, jest, test } from '@jest/globals'
import { makeRuntimeManagedFixture, generateAndAcceptFixtureSection, FIXTURE_NOW } from './fixtures/runtimeManagedSections.fixture.js'
import { assertCustomerSectionTarget, assertRuntimeManagedCustomerWrite, buildRuntimeManagedSourceReceipt, evaluateRuntimeManagedSections, validateRuntimeManagedSectionDeclarations } from '../services/runtimeManagedSectionService.js'
import { evaluateRuntimeSectionTruthReadiness } from '../services/runtimeSectionTruthReadinessService.js'
import { buildRuntimeActionTransition, getRuntimeActionStateGate, validateRuntimeRequiredSections } from '../services/runtimeActionPolicyService.js'
import { buildRendererSections, buildSectionGenerationEligibility } from '../services/runtimeRendererService.js'
import { buildFrameworkOutcomeStudioHandoff, validateFrameworkOutcomeStudioHandoff } from '../services/outcomeFrameworkHandoffService.js'
import FrameworkPackage from '../models/FrameworkPackage.js'
import { validateUpdateFrameworkPackage } from '../validators/frameworkPackage.validator.js'
import { __testables as repositoryTestables } from '../services/runtimeStateRepository.js'

const evaluate = (fixture) => evaluateRuntimeManagedSections({ ...fixture, now: FIXTURE_NOW })
const firstValue = (fixture) => fixture.frameworkState.sections[fixture.guidedKeys[0]]
const refreshSourceReceipt = (fixture) => {
  const section = fixture.frameworkPackage.sections[0]
  firstValue(fixture).generated.runtimeManagedSourceReceipt = buildRuntimeManagedSourceReceipt({
    ...fixture, section, generated: firstValue(fixture).generated,
  })
}
const transition = (fixture, actionKey) => {
  const gate = getRuntimeActionStateGate({ ...fixture, actionKey })
  expect(gate).toEqual({ allowed: true, reason: '' })
  const result = buildRuntimeActionTransition({ ...fixture, actionKey, actorUserId: 'fixture-user' })
  fixture.frameworkState = result.nextFrameworkState
  Object.assign(fixture.runtimeInstance, result.runtimeUpdate, { framework_state: fixture.frameworkState, executionStatus: result.nextExecutionStatus })
  return result
}

describe('SS-022 runtime-managed sections', () => {
  test.each(['VMF', 'CUSTOM'])('deterministic %s smoke: guided generation and acceptance produce internal proof without hidden customer truth', (frameworkKey) => {
    const fixture = makeRuntimeManagedFixture({ frameworkKey, completed: false })
    expect(evaluate(fixture).readySectionCount).toBe(0)
    expect(fixture.frameworkState.sections).not.toHaveProperty(fixture.hiddenKey)
    fixture.guidedKeys.forEach((sectionKey, index) => {
      const value = generateAndAcceptFixtureSection(fixture, sectionKey, index)
      expect(value.generated.generator.mode).toBe('DETERMINISTIC_PLUS_BOUNDED_SYNTHESIS')
      expect(value.accepted.truthHash).toBeTruthy()
      expect(value.accepted.reasoningArtefactReceipts).toEqual(value.generated.reasoningArtefactReceipts)
      expect(value.generated.runtimeManagedSourceReceipt.contractVersion).toBe('runtime-managed-source.v1')
    })
    expect(evaluate(fixture)).toMatchObject({ requiredSectionCount: 1, readySectionCount: 1, blockers: [] })
    const readiness = evaluateRuntimeSectionTruthReadiness(fixture)
    expect(readiness).toMatchObject({ publishEligible: true, lockEligible: true, requiredSectionCount: fixture.guidedKeys.length, blockers: [] })
    expect(readiness.readySectionKeys).not.toContain(fixture.hiddenKey)
    expect(validateRuntimeRequiredSections(fixture)).toMatchObject({ is_valid: true, missingRequiredSections: [] })
    const before = structuredClone(fixture)
    evaluate(fixture)
    evaluateRuntimeSectionTruthReadiness(fixture)
    expect(fixture).toEqual(before)
  })

  test.each(['VMF', 'CUSTOM'])('%s hidden completion survives validation, publish, lock and governed Outcome Studio handoff', (frameworkKey) => {
    const fixture = makeRuntimeManagedFixture({ frameworkKey })
    for (const actionKey of ['RUN_VALIDATION', 'MARK_READY', 'SUBMIT_FOR_REVIEW', 'APPROVE', 'PUBLISH', 'LOCK_RECORD']) transition(fixture, actionKey)
    expect(fixture.runtimeInstance.status).toBe('LOCKED')
    expect(fixture.frameworkState.lock.outputEligibility).toMatchObject({ outputEligible: true, canonicalOutputEligible: true })
    expect(fixture.frameworkState.sections).not.toHaveProperty(fixture.hiddenKey)
    const handoff = buildFrameworkOutcomeStudioHandoff(fixture)
    expect(handoff.blockers).toEqual([])
    expect(handoff.internalCompletion).toEqual(evaluate(fixture).receipts)
    expect(handoff.currentness.internalCompletionHash).toBeTruthy()
    expect(handoff.sectionTruth.map((section) => section.sectionKey)).not.toContain(fixture.hiddenKey)
    expect(validateFrameworkOutcomeStudioHandoff(handoff)).toMatchObject({ valid: true })
  })

  test.each([
    ['hostile visible editable mapping', { isVisible: true, isEditable: true }],
    ['declared hidden readonly mapping', { isVisible: false, isEditable: false, isReadOnlyDisplay: true }],
    ['missing hidden mapping', null],
  ])('package classification hides managed sections with %s', (_label, hiddenUi) => {
    const fixture = makeRuntimeManagedFixture()
    const rendered = buildRendererSections({ ...fixture, discovery: { accepted: true }, mutationAccess: { allowed: true },
      configWarnings: [], runtimePathRecords: new Map(fixture.frameworkPackage.sections.map((section) => [section.runtimePath, { runtimePath: section.runtimePath, dataType: 'OBJECT', allowedOperations: ['READ', 'WRITE'] }])),
      uiContract: { sections: fixture.frameworkPackage.sections.flatMap((section) => section.sectionKey === fixture.hiddenKey
        ? hiddenUi ? [{ ...section, ...hiddenUi }] : []
        : [{ ...section, isVisible: true, isEditable: true }]) },
    })
    expect(rendered.map((section) => section.sectionKey)).toEqual(fixture.guidedKeys)
    expect(rendered.map((section) => section.runtimePath)).not.toContain(fixture.managedSection.runtimePath)
  })

  test.each([
    ['missing source receipt', (f) => { delete firstValue(f).generated.runtimeManagedSourceReceipt }, 'RUNTIME_MANAGED_PROOF_MISSING'],
    ['missing acceptance', (f) => { firstValue(f).accepted = null }, 'RUNTIME_MANAGED_SOURCE_STALE'],
    ['input changed', (f) => { firstValue(f).input.objective = 'Changed customer context' }, 'RUNTIME_MANAGED_SOURCE_STALE'],
    ['source invalidated', (f) => { firstValue(f).state.needsRegeneration = true }, 'RUNTIME_MANAGED_SOURCE_STALE'],
    ['generated content changed', (f) => { firstValue(f).generated.content = 'Unaccepted changed truth' }, 'RUNTIME_MANAGED_SOURCE_STALE'],
    ['evidence reaccepted', (f) => { f.frameworkState.evidence_pack.acceptedAt = '2026-09-08T11:00:00.000Z' }, 'RUNTIME_MANAGED_PROOF_STALE'],
    ['evidence review reopened', (f) => { f.frameworkState.evidence_pack.accepted = false }, 'RUNTIME_MANAGED_EVIDENCE_NOT_CURRENT'],
    ['evidence needs refresh', (f) => { f.frameworkState.evidence_pack.needsRefresh = true }, 'RUNTIME_MANAGED_EVIDENCE_NOT_CURRENT'],
    ['evidence input changed', (f) => { f.frameworkState.evidence_pack.inputs.researchScope = 'Changed' }, 'RUNTIME_MANAGED_PROOF_STALE'],
    ['section evidence changed', (f) => { firstValue(f).additionalEvidence = { attachments: ['new-evidence'] } }, 'RUNTIME_MANAGED_PROOF_STALE'],
    ['package version changed', (f) => { f.frameworkPackage.version = '2.0.0' }, 'RUNTIME_MANAGED_PROOF_STALE'],
    ['workflow binding changed', (f) => { f.frameworkPackage.workflowBindings = [{ actionKey: 'GENERATE_SECTION', policyKey: 'changed-policy', enabled: true }] }, 'RUNTIME_MANAGED_PROOF_STALE'],
    ['source review rejected', (f) => { firstValue(f).review.status = 'REJECTED' }, 'RUNTIME_MANAGED_SOURCE_STALE'],
    ['source review invalidated after acceptance', (f) => { firstValue(f).review.invalidatedAt = '2026-09-08T11:00:00.000Z' }, 'RUNTIME_MANAGED_SOURCE_STALE'],
    ['dependency snapshot drift', (f) => { f.frameworkPackage.dependencyLock.snapshotHash = 'f'.repeat(64) }, 'RUNTIME_MANAGED_PROOF_STALE'],
    ['missing package proof', (f) => { delete f.frameworkPackage.dependencyLock.snapshotId }, 'RUNTIME_MANAGED_PACKAGE_PROOF_MISSING'],
    ['upstream acceptance changed', (f) => { firstValue(f).accepted.truthHash = 'changed-upstream-truth' }, 'RUNTIME_MANAGED_PROOF_STALE'],
  ])('fails closed for %s', (_name, mutate, reason) => {
    const fixture = makeRuntimeManagedFixture({ frameworkKey: 'CUSTOM' })
    mutate(fixture)
    const before = structuredClone(fixture)
    expect(evaluate(fixture)).toMatchObject({ readySectionCount: 0, receipts: [], blockers: [expect.objectContaining({ state: reason })] })
    expect(evaluateRuntimeSectionTruthReadiness(fixture)).toMatchObject({ publishEligible: false, lockEligible: false })
    expect(validateRuntimeRequiredSections(fixture).is_valid).toBe(false)
    expect(fixture).toEqual(before)
  })

  test('treats an empty Runtime State V2 evidence envelope as equivalent to an omitted section evidence envelope', () => {
    const fixture = makeRuntimeManagedFixture({ frameworkKey: 'CUSTOM' })
    firstValue(fixture).additionalEvidence = {}
    expect(evaluate(fixture)).toMatchObject({ readySectionCount: 1, blockers: [] })
  })

  test('fails closed for duplicate artefact receipts even with a recomputed source receipt', () => {
    const fixture = makeRuntimeManagedFixture({ frameworkKey: 'CUSTOM' })
    const generated = firstValue(fixture).generated
    generated.reasoningArtefactReceipts.duplicate = structuredClone(Object.values(generated.reasoningArtefactReceipts)[0])
    refreshSourceReceipt(fixture)
    expect(evaluate(fixture).blockers[0].state).toBe('RUNTIME_MANAGED_PROOF_DUPLICATED')
  })

  test.each(['receipt', 'artefact'])('fails closed when the accepted %s is incompatible', (kind) => {
    const fixture = makeRuntimeManagedFixture({ frameworkKey: 'CUSTOM' })
    const accepted = firstValue(fixture).accepted
    const artefactKey = fixture.frameworkPackage.reasoningArtefacts[0].artefactKey
    if (kind === 'receipt') accepted.reasoningArtefactReceipts[artefactKey].outputHash = 'f'.repeat(64)
    else accepted.reasoningArtefacts[artefactKey].value = 'Different accepted proof'
    expect(evaluate(fixture).blockers[0].state).toBe('RUNTIME_MANAGED_PROOF_INCOMPATIBLE')
  })

  test.each(['alias', 'array'])('rejects duplicate accepted proof receipts carried as an %s', (kind) => {
    const fixture = makeRuntimeManagedFixture({ frameworkKey: 'CUSTOM' })
    const receipts = firstValue(fixture).accepted.reasoningArtefactReceipts
    const receipt = receipts.assuranceRecord1
    if (kind === 'alias') receipts.alias = structuredClone(receipt)
    else firstValue(fixture).accepted.reasoningArtefactReceipts = Object.assign([receipt, structuredClone(receipt)], receipts)
    expect(evaluate(fixture)).toMatchObject({ readySectionCount: 0, blockers: [expect.objectContaining({ state: 'RUNTIME_MANAGED_PROOF_DUPLICATED' })] })
  })

  test('fails closed for schema-invalid artefacts even with a recomputed source receipt', () => {
    const fixture = makeRuntimeManagedFixture({ frameworkKey: 'CUSTOM' })
    firstValue(fixture).generated.reasoningArtefacts.assuranceRecord1 = { unexpected: true }
    refreshSourceReceipt(fixture)
    expect(evaluate(fixture).blockers[0].state).toBe('REASONING_ARTEFACT_SCHEMA_INVALID')
  })

  test('fails closed when a package-declared proof age expires', () => {
    const fixture = makeRuntimeManagedFixture({ frameworkKey: 'CUSTOM', completed: false })
    fixture.frameworkPackage.reasoningArtefacts.forEach((declaration) => { declaration.validation.maxAgeSeconds = 600 })
    fixture.guidedKeys.forEach((sectionKey, index) => generateAndAcceptFixtureSection(fixture, sectionKey, index))
    expect(evaluate(fixture).blockers[0].state).toBe('REASONING_ARTEFACT_STALE')
  })

  test('repeated pure derivation produces the same receipt without writing hidden state', () => {
    const first = makeRuntimeManagedFixture({ frameworkKey: 'CUSTOM' })
    const second = makeRuntimeManagedFixture({ frameworkKey: 'CUSTOM' })
    expect(evaluate(first).receipts).toEqual(evaluate(second).receipts)
    expect(first.frameworkState.sections).not.toHaveProperty(first.hiddenKey)
  })

  test.each([
    ['missing completion metadata', (f) => { delete f.managedSection.runtimeManagedCompletion }],
    ['duplicate source', (f) => { f.managedSection.runtimeManagedCompletion.sourceSectionKeys.push(f.guidedKeys[0]) }],
    ['unknown source', (f) => { f.managedSection.runtimeManagedCompletion.sourceSectionKeys[0] = 'unknown_section' }],
    ['managed source', (f) => { f.managedSection.runtimeManagedCompletion.sourceSectionKeys[0] = f.hiddenKey }],
    ['ineligible artefact', (f) => { f.frameworkPackage.reasoningArtefacts[0].handoff.eligible = false }],
    ['duplicate managed path', (f) => { f.frameworkPackage.sections[0].runtimePath = f.managedSection.runtimePath }],
    ['unknown artefact', (f) => { f.managedSection.runtimeManagedCompletion.reasoningArtefactKeys[0] = 'unknownProof' }],
  ])('rejects invalid declaration: %s', (_name, mutate) => {
    const fixture = makeRuntimeManagedFixture({ frameworkKey: 'CUSTOM', completed: false })
    mutate(fixture)
    expect(() => validateRuntimeManagedSectionDeclarations(fixture.frameworkPackage)).toThrow(expect.objectContaining({ reason: 'RUNTIME_MANAGED_CONTRACT_INVALID' }))
    expect(evaluate(fixture).readySectionCount).toBe(0)
  })

  test('an optional managed section without internal proof requirements does not create a customer-truth gate', () => {
    const fixture = makeRuntimeManagedFixture({ completed: false })
    fixture.managedSection.required = false
    delete fixture.managedSection.runtimeManagedCompletion
    expect(evaluate(fixture)).toMatchObject({ requiredSectionCount: 0, readySectionCount: 0, blockers: [] })
    expect(() => assertCustomerSectionTarget(fixture.managedSection)).toThrow(expect.objectContaining({ reason: 'RUNTIME_MANAGED_CUSTOMER_WRITE_FORBIDDEN' }))
  })

  test.each(['framework_state', 'framework_state.sections', 'hidden', 'hidden.input', 'hidden.accepted', 'source.generated', 'source.accepted', 'source.state', 'source.reasoningArtefacts'])('rejects customer writes to %s', (target) => {
    const fixture = makeRuntimeManagedFixture({ frameworkKey: 'CUSTOM', completed: false })
    const runtimePath = target.replace(/^hidden/, fixture.managedSection.runtimePath).replace(/^source/, fixture.frameworkPackage.sections[0].runtimePath)
    const before = structuredClone(fixture)
    expect(() => assertRuntimeManagedCustomerWrite({ frameworkPackage: fixture.frameworkPackage, runtimePath })).toThrow(expect.objectContaining({ reason: 'RUNTIME_MANAGED_CUSTOMER_WRITE_FORBIDDEN' }))
    expect(fixture).toEqual(before)
  })

  test.each(['', '.input', '.input.objective'])('preserves guided source input writes at root%s', (suffix) => {
    const fixture = makeRuntimeManagedFixture({ completed: false })
    const section = fixture.frameworkPackage.sections[0]
    expect(() => assertCustomerSectionTarget(section)).not.toThrow()
    expect(() => assertRuntimeManagedCustomerWrite({ frameworkPackage: fixture.frameworkPackage, runtimePath: section.runtimePath + suffix })).not.toThrow()
  })

  test('guided generation still requires accepted Intelligence Hub evidence', () => {
    const fixture = makeRuntimeManagedFixture({ completed: false })
    expect(buildSectionGenerationEligibility({ dependencySectionKeys: [], discovery: { accepted: false }, frameworkState: fixture.frameworkState, rawSectionValue: firstValue(fixture) })).toMatchObject({ canGenerate: false })
  })

  test('package update validation and Mongoose casting preserve the completion contract', () => {
    const fixture = makeRuntimeManagedFixture({ frameworkKey: 'CUSTOM', completed: false })
    const request = { body: { sections: fixture.frameworkPackage.sections, reasoningArtefacts: fixture.frameworkPackage.reasoningArtefacts } }
    const next = jest.fn()
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() }
    validateUpdateFrameworkPackage(request, response, next)
    expect(response.status).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
    const model = new FrameworkPackage(request.body)
    const hidden = model.toObject().sections.find((section) => section.sectionKey === fixture.hiddenKey)
    expect(hidden).toMatchObject({ sectionMode: 'RUNTIME_MANAGED', runtimeRole: 'INTERNAL', runtimeManagedCompletion: fixture.managedSection.runtimeManagedCompletion })
  })

  test('bounded V2 handoff section projection retains the same internal proof and fails closed after source drift', () => {
    const fixture = makeRuntimeManagedFixture({ frameworkKey: 'CUSTOM' })
    const include = (value, paths) => {
      if (paths.some((path) => path.length === 0)) return structuredClone(value)
      if (Array.isArray(value)) return value.map((child) => include(child, paths))
      if (value === null || typeof value !== 'object') return value
      return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
        const childPaths = paths.filter((path) => path[0] === key).map((path) => path.slice(1))
        return childPaths.length ? [[key, include(child, childPaths)]] : []
      }))
    }
    const paths = Object.keys(repositoryTestables.RUNTIME_STATE_V2_HANDOFF_SECTION_PROJECTION).map((path) => path.split('.'))
    const expected = evaluate(fixture)
    fixture.frameworkState.sections = Object.fromEntries(Object.entries(fixture.frameworkState.sections).map(([key, value]) => [key, include({ sectionDetail: value }, paths).sectionDetail]))
    expect(evaluate(fixture)).toEqual(expected)
    firstValue(fixture).input.objective = 'Source drift after bounded read'
    expect(evaluate(fixture).readySectionCount).toBe(0)
  })

  test('locked handoff rejects missing internal proof without asking for hidden customer acceptance', () => {
    const fixture = makeRuntimeManagedFixture({ frameworkKey: 'CUSTOM' })
    for (const actionKey of ['RUN_VALIDATION', 'MARK_READY', 'SUBMIT_FOR_REVIEW', 'APPROVE', 'PUBLISH', 'LOCK_RECORD']) transition(fixture, actionKey)
    delete firstValue(fixture).generated.runtimeManagedSourceReceipt
    const handoff = buildFrameworkOutcomeStudioHandoff(fixture)
    expect(handoff.blockers).toContainEqual(expect.objectContaining({ reason: 'RUNTIME_MANAGED_PROOF_MISSING' }))
    expect(handoff.blockers).not.toContainEqual(expect.objectContaining({ code: 'PACKAGE_REQUIRED_SECTION_MISSING', sectionKeys: [fixture.hiddenKey] }))
  })
})
