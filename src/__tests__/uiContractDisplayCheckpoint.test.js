import { jest, beforeEach, afterEach, test, expect } from '@jest/globals'
import FrameworkPackage from '../models/FrameworkPackage.js'
import UIContract from '../models/UIContract.js'
import RuntimeSkill from '../models/RuntimeSkill.js'
import RuntimeSupportAsset from '../models/RuntimeSupportAsset.js'
import WorkflowPolicy from '../models/WorkflowPolicy.js'
import RuntimePathRegistry from '../models/RuntimePathRegistry.js'
import { compareUIContractDisplay } from '../services/uiContractDisplayCompatibilityService.js'
import { runUIContractDisplayCheckpoint } from '../services/uiContractDisplayCheckpointService.js'

const clone = (value) => JSON.parse(JSON.stringify(value))
let pkg, source, candidate, policies, skills, assets, writes, lifecyclePath
const query = (value) => ({ lean: async () => clone(value), select() { return this }, sort() { return this }, session() { return this } })
beforeEach(() => {
  pkg = { packageKey: 'website', version: '1.0.0', frameworkKey: 'WEBSITE', status: 'ACTIVE', isLocked: true,
    uiContractKey: 'old', sections: [{ sectionKey: 'input', runtimePath: 'framework_state.sections.input' }],
    workflowBindings: [{ policyKey: 'generate', enabled: true }],
    dependencyLock: { status: 'PASS', packageKey: 'website', packageVersion: '1.0.0', references: [
      { collectionKey: 'RuntimeSkill', id: 'skill-one', key: 'one', componentVersion: 1, lineageId: 'one' },
    ] } }
  source = { uiContractKey: 'old', name: 'Old', status: 'ACTIVE', versionStatus: 'ACTIVE', isLocked: true,
    frameworkKeys: ['WEBSITE'], sourcePackageKey: 'website', sourcePackageVersion: '1.0.0', compatibilityMode: 'STRICT',
    sections: [{ sectionKey: 'input', runtimePath: 'framework_state.sections.input', label: 'Input', displayOrder: 0 }],
    lifecycleStages: [{ stageKey: 'DRAFT', label: 'Draft', displayOrder: 0 }, { stageKey: 'DONE', label: 'Done', displayOrder: 1 }],
    actions: [{ actionKey: 'GENERATE', governedAction: 'GENERATE_SECTION', buttonLabel: 'Generate', displayOrder: 0, requiresConfirmation: true }] }
  candidate = clone(source); candidate.uiContractKey = 'new'; candidate.name = 'New'; candidate.isLocked = false
  candidate.sections[0].label = 'Website input'
  policies = [{ key: 'generate', status: 'ACTIVE', governedAction: 'GENERATE_SECTION', frameworkKeys: ['WEBSITE'] }]
  lifecyclePath = { pathKey: 'framework_state.lifecycle.stage', status: 'ACTIVE', frameworkKeys: ['WEBSITE'], allowedValues: ['DRAFT', 'DONE'] }
  jest.spyOn(RuntimePathRegistry, 'findOne').mockImplementation(() => query(lifecyclePath))
  skills = [{ stableId: 'skill-one', key: 'one', status: 'ACTIVE', versionStatus: 'ACTIVE', isLocked: true,
    componentVersion: 1, lineageId: 'one', referenceAssets: [
      { assetId: 'asset-instructions-v1', status: 'ACTIVE', isRuntimeAccessible: true },
    ] }]
  assets = [{ assetKey: 'instructions_v1', packageKey: 'website', packageVersion: '1.0.0', ownerType: 'RuntimeSkill',
    ownerKey: 'one', status: 'ACTIVE', runtimeAccessible: true }]
  jest.spyOn(FrameworkPackage, 'findOne').mockImplementation(() => query(pkg))
  jest.spyOn(UIContract, 'findOne').mockImplementation(({ uiContractKey }) => query(uiContractKey === 'old' ? source : candidate))
  jest.spyOn(WorkflowPolicy, 'find').mockImplementation(() => query(policies))
  jest.spyOn(RuntimeSkill, 'find').mockImplementation(() => query(skills))
  jest.spyOn(RuntimeSupportAsset, 'find').mockImplementation(() => query(assets))
  writes = [FrameworkPackage, UIContract, RuntimeSkill, RuntimeSupportAsset, WorkflowPolicy].flatMap((model) =>
    ['create', 'updateOne', 'findOneAndUpdate', 'deleteMany'].map((method) => jest.spyOn(model, method).mockImplementation(() => { throw new Error('WRITE') })))
})
afterEach(() => { writes.forEach((spy) => expect(spy).not.toHaveBeenCalled()); jest.restoreAllMocks() })
const run = () => runUIContractDisplayCheckpoint({ packageId: 'website', uiContractKey: 'new' })
test('display-only checkpoint passes without mutating source, package, or assets; hash stable', async () => {
  const baseline = clone({ pkg, source, candidate, skills, assets })
  const result = await run()
  expect(result).toMatchObject({ compatible: true, status: 'PASS', persisted: false, issues: [] })
  expect(result.checkpointHash).toMatch(/^[a-f0-9]{64}$/)
  expect((await run()).checkpointHash).toBe(result.checkpointHash)
  expect({ pkg, source, candidate, skills, assets }).toEqual(baseline)
  policies[0].updatedAt = '2026-09-11'
  expect((await run()).checkpointHash).not.toBe(result.checkpointHash)
})
test.each(['runtimePath', 'sectionKey', 'sectionMode', 'runtimeRole', 'required', 'unknownSemantic'])('rejects section structural change %s', (field) => {
  candidate.sections[0][field] = 'changed'
  expect(compareUIContractDisplay(source, candidate).compatible).toBe(false)
})
test.each(['governedAction', 'requiresConfirmation', 'unknownSemantic'])('rejects action structural change %s', (field) => {
  candidate.actions[0][field] = 'changed'
  expect(compareUIContractDisplay(source, candidate).compatible).toBe(false)
})
test('rejects unknown top-level semantics and non-JSON input', () => {
  candidate.future = true
  expect(compareUIContractDisplay(source, candidate).compatible).toBe(false)
  delete candidate.future; candidate.createdAt = new Date()
  expect(compareUIContractDisplay(source, candidate).reason).toBe('INVALID_UI_CONTRACT_JSON')
})
test('preserves relative lifecycle order even when numeric values change', () => {
  candidate.lifecycleStages[0].displayOrder = 10; candidate.lifecycleStages[1].displayOrder = 20
  expect(compareUIContractDisplay(source, candidate).compatible).toBe(true)
  candidate.lifecycleStages.reverse()
  candidate.lifecycleStages[0].displayOrder = 0
  expect(compareUIContractDisplay(source, candidate).reason).toBe('UI_CONTRACT_ORDER_CHANGE')
})
test('allows section ordering and all display metadata', () => {
  Object.assign(candidate.sections[0], { displayOrder: 10, isVisible: false, isReadOnlyDisplay: true, placeholder: 'URL', iconKey: 'web' })
  expect(compareUIContractDisplay(source, candidate).compatible).toBe(true)
})
test('preserves action order including hidden actions', () => {
  for (const ui of [source, candidate]) ui.actions.push({ actionKey: 'ACCEPT', governedAction: 'ACCEPT', displayOrder: 1, isVisible: false })
  candidate.actions[0].displayOrder = 2
  expect(compareUIContractDisplay(source, candidate).reason).toBe('UI_CONTRACT_ORDER_CHANGE')
})
test.each([-1, 0.5, 10001])('rejects invalid display order %s', (value) => {
  candidate.sections[0].displayOrder = value
  expect(compareUIContractDisplay(source, candidate).compatible).toBe(false)
})
test('rejects duplicate hidden lifecycle orders but allows hidden section ties', () => {
  candidate.lifecycleStages[1].displayOrder = 0; candidate.lifecycleStages[1].isVisible = false
  expect(compareUIContractDisplay(source, candidate).reason).toBe('INVALID_UI_CONTRACT_ORDER')
  candidate.lifecycleStages[1].displayOrder = 1
  for (const ui of [source, candidate]) ui.sections.push({ sectionKey: 'internal', displayOrder: 0, isVisible: false })
  expect(compareUIContractDisplay(source, candidate).compatible).toBe(true)
})
test('accepts realistic clone supersession metadata', () => {
  source.supersededByStableId = 'ui-contract-new'
  candidate.supersededByStableId = null
  candidate.supersedesStableId = 'ui-contract-old'
  candidate.clonedFromStableId = 'ui-contract-old'
  expect(compareUIContractDisplay(source, candidate).compatible).toBe(true)
})
test('hashes lifecycle declaration drift', async () => {
  const before = await run()
  lifecyclePath.allowedValues.push('OTHER')
  expect((await run()).checkpointHash).not.toBe(before.checkpointHash)
})
test('passes session through reads and hashes asset metadata drift', async () => {
  const session = { marker: 'transaction' }
  const sessionSpy = jest.fn().mockReturnValue(query(pkg))
  FrameworkPackage.findOne.mockReturnValue({ session: sessionSpy })
  const first = await runUIContractDisplayCheckpoint({ packageId: 'website', uiContractKey: 'new', session })
  expect(sessionSpy).toHaveBeenCalledWith(session)
  assets[0].contentHash = 'new-content-hash'
  const second = await runUIContractDisplayCheckpoint({ packageId: 'website', uiContractKey: 'new', session })
  expect(second.checkpointHash).not.toBe(first.checkpointHash)
})
test.each([
  ['package unlocked', () => { pkg.isLocked = false }],
  ['source unlocked', () => { source.isLocked = false }],
  ['candidate inactive', () => { candidate.versionStatus = 'DRAFT' }],
  ['framework mismatch', () => { candidate.frameworkKeys = ['OTHER'] }],
  ['version mismatch', () => { candidate.sourcePackageVersion = '2.0.0' }],
  ['missing mapping', () => { source.sections = []; candidate.sections = [] }],
  ['duplicate mapping', () => { candidate.sections.push(clone(candidate.sections[0])) }],
  ['orphan mapping', () => { candidate.sections.push({ sectionKey: 'orphan', displayOrder: 1 }) }],
  ['path mismatch', () => { candidate.sections[0].runtimePath = 'wrong' }],
  ['unbound policy', () => { pkg.workflowBindings = [] }],
  ['inactive policy', () => { policies[0].status = 'DRAFT' }],
  ['disabled policy', () => { pkg.workflowBindings[0].enabled = false }],
  ['hidden unbound action', () => { candidate.actions[0].isVisible = false; policies = [] }],
  ['missing asset', () => { assets = [] }],
  ['ambiguous asset', () => { assets.push({ ...assets[0], assetKey: 'instructions-v1' }) }],
  ['wrong owner asset', () => { assets[0].ownerKey = 'other' }],
  ['wrong version asset', () => { assets[0].packageVersion = '2.0.0' }],
  ['wrong skill version', () => { skills[0].componentVersion = 2 }],
  ['missing locked skill', () => { skills = [] }],
  ['missing lock', () => { delete pkg.dependencyLock }],
  ['missing lifecycle path', () => { lifecyclePath = null }],
  ['inactive lifecycle path', () => { lifecyclePath.status = 'DRAFT' }],
  ['wrong-framework lifecycle path', () => { lifecyclePath.frameworkKeys = ['OTHER'] }],
  ['undeclared hidden lifecycle', () => { candidate.lifecycleStages[1].isVisible = false; lifecyclePath.allowedValues = ['DRAFT'] }],
  ['orphan support owner with no references', () => { skills[0].referenceAssets = []; assets[0].ownerKey = 'orphan' }],
])('fails closed: %s', async (_name, mutate) => { mutate(); expect((await run()).compatible).toBe(false) })
test('storage filename fallback resolves without reading content or reasoning gates', async () => {
  delete skills[0].referenceAssets[0].assetId
  skills[0].referenceAssets[0].storageKey = 'folder/instructions_v1.md'
  expect((await run()).compatible).toBe(true)
  expect(RuntimeSupportAsset.find).toHaveBeenCalledWith(expect.objectContaining({ packageKey: 'website', ownerType: 'RuntimeSkill' }))
})
test('ineligible assets are excluded', async () => {
  skills[0].referenceAssets[0].isAdminOnly = true; assets = []
  expect((await run()).compatible).toBe(true)
})
test('explicit optional runtime-managed section may be absent, but must stay hidden if present', async () => {
  pkg.sections.push({ sectionKey: 'internal', runtimePath: 'framework_state.sections.internal', sectionMode: 'RUNTIME_MANAGED', required: false })
  expect((await run()).compatible).toBe(true)
  for (const ui of [source, candidate]) ui.sections.push({ sectionKey: 'internal', runtimePath: 'framework_state.sections.internal', displayOrder: 1, isVisible: false })
  expect((await run()).compatible).toBe(true)
  candidate.sections[1].isVisible = true
  expect((await run()).compatible).toBe(false)
})
test('required managed section without completion accounting fails', async () => {
  pkg.sections.push({ sectionKey: 'internal', runtimePath: 'framework_state.sections.internal', sectionMode: 'RUNTIME_MANAGED', required: true })
  expect((await run()).compatible).toBe(false)
})
