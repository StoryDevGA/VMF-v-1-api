import { describe, expect, test } from '@jest/globals'
import { checkRuntimeReleaseAuthoredCompatibility as check } from '../services/runtimeReleaseCompatibilityService.js'
const clone = (value) => JSON.parse(JSON.stringify(value))

const fixture = () => {
  const sourcePackage = {
    _id: 'package-1', packageKey: 'vmf-1', version: '3.1.5', frameworkKey: 'VMF',
    status: 'ACTIVE', isLocked: true, sections: [{ sectionKey: 'context', runtimePath: 'framework_state.sections.context' }],
    runtimeSettings: {}, executionModel: {}, validationBindings: [],
    workflowBindings: [{ policyKey: 'generate', executionContext: 'ON_GENERATE', priority: 1, enabled: true }],
    uiContractKey: 'ui-1', uiContractBinding: { key: 'ui-1', version: '1', status: 'ACTIVE' },
  }
  const sourceUi = {
    _id: 'ui-id-1', uiContractKey: 'ui-1', status: 'ACTIVE', isLocked: true,
    frameworkKeys: ['VMF'], sections: [{ sectionKey: 'context' }], lifecycleStages: [],
    actions: [{ actionKey: 'APPROVE', governedAction: 'APPROVE' }],
  }
  const addedPolicy = {
    key: 'return-draft', frameworkKeys: ['VMF'], status: 'ACTIVE', isLocked: true,
    governedAction: 'RETURN_TO_DRAFT', policyType: 'LIFECYCLE_GATE', appliesTo: 'FRAMEWORK_LIFECYCLE',
    triggerEvent: 'ON_STAGE_CHANGE', triggerMode: 'PRE_ACTION', actorScope: 'ANY',
    decisionMode: 'ALLOW', executionType: 'SINGLE_STEP', requireSuccess: true,
    overrideAllowed: false, approvalRequired: false,
    conditions: [], steps: [], orderedSteps: [], gatingRules: [], onPassEffects: [], onFailEffects: [],
    requiredAgentIds: [], requiredSkillIds: [], requiredValidationKeys: [],
    primaryAgentId: '', fallbackAgentId: '', escalationRoleKey: '', escalateTo: '',
  }
  return {
    sourcePackage, sourceUi, addedPolicy,
    targetPackage: {
      ...clone(sourcePackage), _id: 'package-2', packageKey: 'vmf-2', version: '3.1.6',
      derivedFromPackageId: 'package-1', uiContractKey: 'ui-2',
      uiContractBinding: { key: 'ui-2', version: '2', status: 'ACTIVE' },
      workflowBindings: [...clone(sourcePackage.workflowBindings), {
        policyKey: 'return-draft', executionContext: 'ON_STAGE_EXIT', priority: 2, enabled: true,
      }],
    },
    targetUi: {
      ...clone(sourceUi), _id: 'ui-id-2', uiContractKey: 'ui-2', actions: [
        ...clone(sourceUi.actions), { actionKey: 'RETURN_TO_DRAFT', governedAction: 'RETURN_TO_DRAFT',
          buttonLabel: 'Return to Draft', displayOrder: 60, isVisible: true, requiresConfirmation: true },
      ],
    },
  }
}
const freeze = (value) => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

describe('authored release compatibility (not adoption readiness)', () => {
  test('accepts only authored delta without certifying adoption or mutating frozen inputs', () => {
    const input = freeze(fixture())
    expect(check(input)).toEqual({ contractVersion: 'runtime-release-authored-compatibility.v1',
      authoredConfigurationCompatible: true, reason: null, adoptionReady: false })
  })
  test('object key order is irrelevant', () => {
    const input = fixture()
    input.targetPackage.sections[0] = { runtimePath: 'framework_state.sections.context', sectionKey: 'context' }
    expect(check(input).authoredConfigurationCompatible).toBe(true)
  })
  test.each([
    ['different framework', (x) => { x.targetPackage.frameworkKey = 'OTHER' }],
    ['different ancestry', (x) => { x.targetPackage.derivedFromPackageId = 'unrelated' }],
    ['same package', (x) => { x.targetPackage._id = x.sourcePackage._id }],
    ['same version', (x) => { x.targetPackage.version = '3.1.5' }],
    ['downgrade', (x) => { x.targetPackage.version = '3.1.4' }],
    ['invalid version', (x) => { x.targetPackage.version = 'new' }],
    ['draft release', (x) => { x.targetPackage.status = 'DRAFT' }],
    ['unlocked release', (x) => { x.targetPackage.isLocked = false }],
    ['conflicting identity', (x) => { x.targetPackage.id = 'wrong' }],
    ['malformed metadata', (x) => { x.targetPackage.description = {} }],
    ['missing sections', (x) => { delete x.sourcePackage.sections; delete x.targetPackage.sections }],
    ['section change', (x) => { x.targetPackage.sections[0].runtimePath = 'another' }],
    ['unknown behavior', (x) => { x.targetPackage.futureOverride = true }],
    ['generation change', (x) => { x.targetPackage.executionModel.agent = 'different' }],
    ['shared UI identity', (x) => { x.targetUi._id = x.sourceUi._id }],
    ['wrong UI key', (x) => { x.targetPackage.uiContractKey = 'wrong' }],
    ['wrong UI binding', (x) => { x.targetPackage.uiContractBinding.key = 'wrong' }],
    ['binding mode', (x) => { x.targetPackage.uiContractBinding.compatibilityMode = 'ANY' }],
    ['UI section change', (x) => { x.targetUi.sections[0].isEditable = true }],
    ['action reordered', (x) => { x.targetUi.actions.reverse() }],
    ['extra action', (x) => { x.targetUi.actions.push({ actionKey: 'UNLOCK' }) }],
    ['existing action modified', (x) => { x.targetUi.actions[0].governedAction = 'UNLOCK' }],
    ['unknown action property', (x) => { x.targetUi.actions[1].override = true }],
    ['no confirmation', (x) => { x.targetUi.actions[1].requiresConfirmation = false }],
    ['hidden action', (x) => { x.targetUi.actions[1].isVisible = false }],
    ['malformed action order', (x) => { x.targetUi.actions[1].displayOrder = 0.5 }],
    ['null action', (x) => { x.targetUi.actions[1] = null }],
    ['binding reordered', (x) => { x.targetPackage.workflowBindings.reverse() }],
    ['binding policy mismatch', (x) => { x.targetPackage.workflowBindings[1].policyKey = 'wrong' }],
    ['wrong binding context', (x) => { x.targetPackage.workflowBindings[1].executionContext = 'ON_RUN' }],
    ['unknown binding property', (x) => { x.targetPackage.workflowBindings[1].override = true }],
    ['disabled binding', (x) => { x.targetPackage.workflowBindings[1].enabled = false }],
    ['invalid priority', (x) => { x.targetPackage.workflowBindings[1].priority = -1 }],
    ['reused policy key', (x) => { x.addedPolicy.key = 'generate'; x.targetPackage.workflowBindings[1].policyKey = 'generate' }],
    ['priority collision', (x) => { for (const p of [x.sourcePackage, x.targetPackage]) p.workflowBindings[0].executionContext = 'ON_STAGE_EXIT'; x.targetPackage.workflowBindings[1].priority = 1 }],
    ['policy override', (x) => { x.addedPolicy.overrideAllowed = true }],
    ['policy approval', (x) => { x.addedPolicy.approvalRequired = true }],
    ['policy effect', (x) => { x.addedPolicy.onPassEffects = [{ path: 'truth' }] }],
    ['policy agent', (x) => { x.addedPolicy.primaryAgentId = 'agent' }],
    ['policy escalation', (x) => { x.addedPolicy.escalateTo = 'role' }],
    ['policy unknown field', (x) => { x.addedPolicy.allowEverything = true }],
    ['policy missing guard', (x) => { delete x.addedPolicy.requireSuccess }],
    ['policy missing array', (x) => { delete x.addedPolicy.gatingRules }],
    ['missing null distinction', (x) => { x.targetPackage.runtimeSettings.optional = null }],
  ])('rejects %s without mutation', (_name, mutate) => {
    const input = fixture(); mutate(input); const before = structuredClone(input); freeze(input)
    expect(check(input).authoredConfigurationCompatible).toBe(false)
    expect(check(input).adoptionReady).toBe(false)
    expect(input).toEqual(before)
  })
  test.each([undefined, null, [], {}, { sourcePackage: new Date() }, { sourcePackage: Infinity }])(
    'rejects malformed input %#', (input) => expect(check(input).authoredConfigurationCompatible).toBe(false),
  )
  test('rejects accessors without executing them', () => {
    const input = fixture()
    Object.defineProperty(input.targetPackage, 'description', { enumerable: true, get() { throw new Error('executed') } })
    expect(check(input).reason).toBe('INVALID_INPUT')
  })
  test('rejects cyclic input', () => {
    const input = fixture(); input.targetPackage.cycle = input
    expect(check(input).reason).toBe('INVALID_INPUT')
  })
  test.each(['sourcePackage', 'targetPackage'])('validates excluded binding metadata on %s', (side) => {
    for (const [key, value] of [['version', { behavior: true }], ['resolvedAt', 42], ['resolvedAt', 'invalid']]) {
      const input = fixture()
      expect(check(input).authoredConfigurationCompatible).toBe(true)
      input[side].uiContractBinding[key] = value
      expect(check(freeze(input)).reason).toBe('INVALID_METADATA')
    }
  })
  test.each([-1, 10001])('rejects action displayOrder %s', (value) => {
    const input = fixture()
    expect(check(input).authoredConfigurationCompatible).toBe(true)
    input.targetUi.actions[1].displayOrder = value
    expect(check(input).reason).toBe('ACTION_DELTA_INVALID')
  })
  test.each([0, 10001])('rejects policy binding priority %s', (value) => {
    const input = fixture()
    expect(check(input).authoredConfigurationCompatible).toBe(true)
    input.targetPackage.workflowBindings[1].priority = value
    expect(check(input).reason).toBe('WORKFLOW_DELTA_INVALID')
  })
  test.each([[0, 1], [10000, 10000]])('accepts numeric bounds %s / %s', (order, priority) => {
    const input = fixture()
    input.targetUi.actions[1].displayOrder = order
    input.targetPackage.workflowBindings[1].priority = priority
    expect(check(freeze(input)).authoredConfigurationCompatible).toBe(true)
  })
  test('rejects sparse array with a named property even in matching configurations', () => {
    const input = fixture()
    expect(check(input).authoredConfigurationCompatible).toBe(true)
    const sparse = new Array(1); sparse.extra = true
    input.sourcePackage.runtimeSettings.values = sparse
    input.targetPackage.runtimeSettings.values = sparse
    expect(check(freeze(input)).reason).toBe('INVALID_INPUT')
  })
})
