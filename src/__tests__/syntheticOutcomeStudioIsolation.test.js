import { describe, test, expect, jest, beforeAll, beforeEach, afterEach } from '@jest/globals'

const root = '6ace5ee09bd4472c6be0cb07'
const runtime = { _id: root, runtimeInstanceKey: 'ss044-disposable-synthetic-20261013-r1',
  customerId: '6a6c75f2cace7a21bd41ef98', tenantId: '6a6c76e3cace7a21bd41eff9', runtimeType: 'VALUE_NARRATIVE' }
const nativeRead = jest.fn(async () => runtime)
const permission = jest.fn(async () => {})
const unexpected = jest.fn(() => { throw new Error('Unexpected downstream owner in denied synthetic request') })
let studio, lab, planner, models, successor, successorPresentation
beforeAll(async () => {
  jest.unstable_mockModule('../services/runtimeInstanceService.js', () => ({
    getRuntimeInstance: nativeRead, assertRuntimePermission: permission,
    RUNTIME_INSTANCE_ERROR_REASONS: {}, RUNTIME_INSTANCE_RENDERER_PROJECTION: '',
    toIdString: value => String(value || ''), normalizeToken: value => String(value || '').trim().toUpperCase(),
    createRuntimeInstanceError: unexpected, assertCustomerTenantContext: unexpected,
    assertFeatureEntitlement: unexpected, getFeatureForRuntimeType: unexpected, serializeRuntimeInstance: unexpected,
  }))
  ;({ default: models } = await import('../models/index.js'))
  studio = await import('../services/outcomeStudioService.js')
  lab = await import('../services/runtimeOutputLabService.js')
  planner = await import('../services/outcomeStudioRequestPlanService.js')
  successor = await import('../services/outcomeSuccessorService.js')
  successorPresentation = await import('../services/outcomeSuccessorPresentationService.js')
})
beforeEach(() => {
  nativeRead.mockReset().mockResolvedValue(runtime); permission.mockReset().mockResolvedValue(undefined); unexpected.mockClear()
  jest.spyOn(models.RuntimeInstance, 'findOne').mockReturnValue({ lean: async () => runtime,
    then: (resolve, reject) => Promise.resolve(runtime).then(resolve, reject) })
  for (const name of ['OutcomeAsset', 'OutcomeAssetVersion', 'OutcomeDraft', 'OutcomeSession']) {
    jest.spyOn(models[name], 'findOne').mockImplementation(unexpected)
    jest.spyOn(models[name], 'find').mockImplementation(unexpected)
    jest.spyOn(models[name], 'create').mockImplementation(unexpected)
  }
})

test.each(['marked', 'orphan'])('normal planning/assets/export/OutputLab/successor deny new %s replay origin before downstream work', async kind => {
  const native = { ...runtime, _id: '5'.repeat(24), runtimeInstanceKey: 'ss049-metadata-r1',
    stateVersion: 'rsv2:11111111-1111-4111-8111-111111111111' }
  const { attachNativeControlledReplayIsolation } = await import('../services/controlledReplayIsolationService.js')
  const { default: Source } = await import('../models/RuntimeEvidenceSource.js')
  const { default: Evidence } = await import('../models/RuntimeEvidenceObject.js')
  const probe = value => ({ select() { return this }, maxTimeMS() { return this }, limit() { return this }, lean: async () => value })
  const first = jest.spyOn(Source, 'findOne').mockReturnValue(probe({ _id: 'native-orphan' }))
  const second = jest.spyOn(Evidence, 'findOne').mockReturnValue(probe(null))
  if (kind === 'marked') native.controlledReplayIsolation = null
  await attachNativeControlledReplayIsolation(native)
  nativeRead.mockResolvedValue(native)
  models.RuntimeInstance.findOne.mockReturnValue({ lean: async () => native,
    then: (resolve, reject) => Promise.resolve(native).then(resolve, reject) })
  try {
    for (const run of [studio.getRuntimeOutcomeAsset, studio.exportRuntimeOutcomeAsset,
      planner.planOutcomeStudioRequest, lab.exportRuntimeOutputAsset, successor.getOutcomeSuccessorPreflight]) {
      await expect(run(args())).rejects.toMatchObject({ status: 409, details: { reason: 'CONTROLLED_REPLAY_ISOLATED' } })
    }
    expect(unexpected).not.toHaveBeenCalled()
  } finally { first.mockRestore(); second.mockRestore() }
})
afterEach(() => jest.restoreAllMocks())
const args = () => ({ actorUserId: '698b3800f83b3257365fd7a3', runtimeInstanceId: root,
  scopes: {}, sessionId: 'historical-session', outcomeAssetId: 'historical-asset',
  outcomeAssetVersionId: 'historical-version', draftId: 'draft', messageId: 'message', format: 'MARKDOWN',
  payload: { request: 'controlled request', prompt: 'controlled request' } })
const blocked = { code: 'SYNTHETIC_OUTCOME_ISOLATED', status: 409 }
describe('actual normal Studio entry owners', () => {
  test.each(['getRuntimeOutcomeStudio', 'getRuntimeOutcomeStudioReadiness', 'getRuntimeOutcomeSession',
    'listRuntimeOutcomeSessionAssets', 'getRuntimeOutcomeAsset', 'getRuntimeOutcomeAssetVersion',
    'getRuntimeOutcomeAssetPreview', 'getRuntimeOutcomeDraftPreview', 'getRuntimeOutcomeDraftCompare',
    'createRuntimeOutcomeSession', 'createRuntimeOutcomeMessage', 'generateRuntimeOutcomeResponse',
    'reviseRuntimeOutcomeAsset', 'approveRuntimeOutcomeDraft', 'discardRuntimeOutcomeDraft',
    'publishRuntimeOutcomeAsset', 'exportRuntimeOutcomeAsset', 'listRuntimeOutcomeAssetRenderOutputs',
    'updateRuntimeOutcomeSessionFromLatestTruth'])('%s denies before content/audit/provider work', async name => {
    await expect(studio[name](args())).rejects.toMatchObject(blocked)
    expect(unexpected).not.toHaveBeenCalled()
  })
  test.each(['exportRuntimeOutcomeAsset', 'renderRuntimeOutcomeAsset'])('%s checks native runtime returned by injected reader', async name => {
    const input = { ...args(), format: name.startsWith('render') ? 'HTML' : 'MARKDOWN',
      deps: { getRuntimeInstance: jest.fn(async () => runtime) } }
    await expect(studio[name](input)).rejects.toMatchObject(blocked)
    expect(input.deps.getRuntimeInstance).toHaveBeenCalled()
    expect(unexpected).not.toHaveBeenCalled()
  })
  test.each(['createRuntimeOutcomeSession', 'generateRuntimeOutcomeResponse', 'approveRuntimeOutcomeDraft'])('%s checks returned mutation authority runtime too', async name => {
    await expect(studio[name]({ ...args(), deps: { assertMutationPermission: async () => runtime } })).rejects.toMatchObject(blocked)
    expect(unexpected).not.toHaveBeenCalled()
  })
  test('does not convert rejected native reader promises to an empty successful result', async () => {
    nativeRead.mockRejectedValue(new Error('Native scope dependency failed'))
    await expect(studio.getRuntimeOutcomeAsset(args())).rejects.toThrow('Native scope dependency failed')
    expect(unexpected).not.toHaveBeenCalled()
  })
})
describe('actual Output Lab and planner gates', () => {
  test.each([true, false])('successor by-key target checks permission first, denied=%s', async denied => {
    const ordinary = { ...runtime, _id: '6a0000000000000000000011', runtimeInstanceKey: 'ordinary' }
    const checkPermission = jest.fn(async () => {
      if (denied) throw Object.assign(new Error('Target permission denied'), { code: 'FORBIDDEN', status: 403 })
    })
    await expect(successorPresentation.getOutcomeSuccessorOperationByKey({ ...args(), runtimeInstanceId: ordinary._id,
      targetRuntimeInstanceId: root, idempotencyKey: 'engineering-test', deps: {
        getSourcePreview: async () => ({}),
        readRuntimeControl: async ({ runtimeInstanceId }) => runtimeInstanceId === root ? runtime : ordinary,
        assertRuntimePermission: checkPermission, readOne: unexpected,
      } })).rejects.toMatchObject(denied ? { code: 'FORBIDDEN', status: 403 } : blocked)
    expect(checkPermission).toHaveBeenCalled()
    expect(unexpected).not.toHaveBeenCalled()
  })
  test.each(['rootRuntimeId', 'parentRuntimeId'])('native planning projection preserves %s before classifying a descendant', async field => {
    nativeRead.mockImplementation(async ({ projection }) => {
      const native = { ...runtime, _id: '6a0000000000000000000011', runtimeInstanceKey: 'descendant', revision: {} }
      if (String(projection).includes('revision.' + field)) native.revision[field] = root
      return native
    })
    await expect(planner.planOutcomeStudioRequest(args())).rejects.toMatchObject(blocked)
    expect(nativeRead.mock.calls[0][0].projection).toContain('revision.' + field)
    expect(unexpected).not.toHaveBeenCalled()
  })
  test.each(['mutation', 'selected-preview'])('rejected %s permission remains authoritative before isolation', async seam => {
    permission.mockRejectedValue(Object.assign(new Error('Native permission denied'), { code: 'FORBIDDEN', status: 403 }))
    const run = seam === 'mutation' ? studio.createRuntimeOutcomeSession : successorPresentation.getOutcomeSelectedVersionPreview
    await expect(run(args())).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
    expect(unexpected).not.toHaveBeenCalled()
  })
  test('successor preflight rejects native synthetic source before looking up source assets', async () => {
    await expect(successor.getOutcomeSuccessorPreflight(args())).rejects.toMatchObject(blocked)
    expect(unexpected).not.toHaveBeenCalled()
  })
  test('selected historical successor preview rejects native synthetic source before content lookup', async () => {
    await expect(successorPresentation.getOutcomeSelectedVersionPreview(args())).rejects.toMatchObject(blocked)
    expect(unexpected).not.toHaveBeenCalled()
  })
  test.each(['getRuntimeOutputLabReadiness', 'getRuntimeOutputLab', 'createRuntimeOutputRequest',
    'getRuntimeOutputRequest', 'generateRuntimeOutputAsset', 'listRuntimeOutputAssets',
    'getRuntimeOutputAsset', 'publishRuntimeOutputAsset', 'exportRuntimeOutputAsset'])('%s denies normal synthetic access', async name => {
    await expect(lab[name]({ ...args(), payload: { outputTypeKey: 'EXECUTIVE_BRIEF' },
      outputRequestId: 'request', outputAssetId: 'asset' })).rejects.toMatchObject(blocked)
    expect(unexpected).not.toHaveBeenCalled()
  })
  test('planning rejects before package/provider/plan work', async () => {
    await expect(planner.planOutcomeStudioRequest({ ...args(), deps: {
      readRuntimeControl: async () => runtime, assertRuntimePermission: permission,
      resolveBinding: unexpected,
    } })).rejects.toMatchObject(blocked)
    expect(unexpected).not.toHaveBeenCalled()
  })
  test('native permission failure remains authoritative', async () => {
    permission.mockRejectedValue(Object.assign(new Error('Denied native permission'), { status: 403 }))
    await expect(lab.getRuntimeOutputLab(args())).rejects.toMatchObject({ status: 403 })
    expect(unexpected).not.toHaveBeenCalled()
  })
})
