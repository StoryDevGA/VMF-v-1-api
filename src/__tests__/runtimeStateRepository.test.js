import { afterAll, beforeEach, describe, expect, jest, test } from '@jest/globals'
import mongoose from 'mongoose'

const getRuntimeInstance = jest.fn()
const resolveFrameworkOutcomeStudioHandoff = jest.fn()
const buildFrameworkOutcomeHandoffV2ParityDigest = jest.fn(() => 'sha256:bounded-state-digest')
const FRAMEWORK_OUTCOME_HANDOFF_V2_PARITY_CONTRACT_VERSION = 'ss-014.runtime-state-v2.handoff-state-parity.v1'
const FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_READ_POLICY = Object.freeze({
  policyVersion: 'ss-014.runtime-state-v2.handoff-dependencies.v1',
  maxTimeMS: 2000,
  packageLimit: 2,
  activationLimit: 501,
  versionLimit: 501,
  commandIds: Object.freeze([
    'HANDOFF_CONTROL_READ',
    'HANDOFF_FRAMEWORK_PACKAGE_READ',
    'HANDOFF_KNOWLEDGE_ACTIVATION_READ',
    'HANDOFF_KNOWLEDGE_VERSION_READ',
    'HANDOFF_RENDERER_CAPABILITY_READ',
  ]),
})

await jest.unstable_mockModule('../services/runtimeInstanceService.js', () => ({
  getRuntimeInstance,
}))

await jest.unstable_mockModule('../services/outcomeFrameworkHandoffService.js', () => ({
  resolveFrameworkOutcomeStudioHandoff,
  FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_READ_POLICY,
  FRAMEWORK_OUTCOME_HANDOFF_V2_PARITY_CONTRACT_VERSION,
  buildFrameworkOutcomeHandoffV2ParityDigest,
}))

const {
  RUNTIME_STATE_V2_COLLECTIONS,
  RUNTIME_STATE_V2_CONTROL_PROJECTION,
  RUNTIME_STATE_V2_ERROR_CODES,
  RUNTIME_STATE_V2_EVIDENCE_COUNT_LIMIT,
  RUNTIME_STATE_V2_GRAPH_EDGE_LIMIT,
  RUNTIME_STATE_V2_MAX_SERIALIZED_READ_BYTES,
  RUNTIME_STATE_V2_READ_MAX_TIME_MS,
  RUNTIME_STATE_V2_SECTION_CATALOGUE_LIMIT,
  getRuntimeStateBootstrap,
  getRuntimeStateControl,
  getRuntimeStateGraphManifest,
  getRuntimeStateGraphProjection,
  getRuntimeStateOutcomeHandoffReadiness,
  getRuntimeStateRendererSections,
  getRuntimeStateSectionSummary,
  listRuntimeStateEvidenceObjects,
  __testables,
} = await import('../services/runtimeStateRepository.js')

const RUNTIME_ID = '507f1f77bcf86cd799439011'
const CUSTOMER_ID = '507f1f77bcf86cd799439012'
const TENANT_ID = '507f1f77bcf86cd799439013'
const SCOPES = {
  customer: { _id: CUSTOMER_ID },
  tenant: { _id: TENANT_ID, customerId: CUSTOMER_ID },
}

const makeSectionDetail = (overrides = {}) => ({
  input: 'Migrated section input',
  generated: null,
  accepted: null,
  review: {},
  state: { status: 'DRAFT' },
  lineage: {
    sectionKey: 'section_1_executive_summary',
    runtimePath: 'framework_state.sections.section_1_executive_summary',
  },
  revisions: [],
  dependencies: {},
  validation: {},
  confidence: {},
  intelligence: {},
  metrics: {},
  additionalEvidence: {},
  evidenceObjects: [],
  gsilContext: {},
  ...overrides,
})

const makeControl = (overrides = {}) => ({
  id: RUNTIME_ID,
  runtimeInstanceKey: 'runtime-one',
  customerId: CUSTOMER_ID,
  tenantId: TENANT_ID,
  runtimeType: 'VALUE_NARRATIVE',
  frameworkKey: 'VMF',
  packageId: '507f1f77bcf86cd799439014',
  packageKey: 'standard-package',
  packageVersion: '3.1.1',
  status: 'ACTIVE',
  executionStatus: 'IDLE',
  runtimeMode: 'INTERACTIVE',
  revision: { revisionNumber: 1 },
  stateVersion: 'runtime-revision:1',
  ...overrides,
})

const makeCursor = (rows) => ({
  maxTimeMS: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  toArray: jest.fn().mockResolvedValue(rows),
})

const collections = new Map()
const collectionSpy = jest.spyOn(mongoose.connection, 'collection').mockImplementation((name) => {
  const collection = collections.get(name)
  if (!collection) throw new Error(`Unexpected collection: ${name}`)
  return collection
})

beforeEach(() => {
  getRuntimeInstance.mockReset()
  getRuntimeInstance.mockResolvedValue(makeControl())
  resolveFrameworkOutcomeStudioHandoff.mockReset()
  resolveFrameworkOutcomeStudioHandoff.mockResolvedValue({
    handoff: {
      status: 'BLOCKED',
      blockerCount: 1,
    },
  })
  collectionSpy.mockClear()
  collections.clear()
  collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, {
    find: jest.fn().mockReturnValue(makeCursor([])),
  })
  collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, {
    find: jest.fn().mockReturnValue(makeCursor([])),
  })
  collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_SOURCES, {
    find: jest.fn().mockReturnValue(makeCursor([{
      sourceId: 'source-1',
      sourceType: 'WEBSITE',
      title: 'Customer website',
      sourceRef: 'https://acme.example',
      acquisitionStatus: 'ACQUIRED',
      lineageRef: 'framework_state.evidence_pack.sources[0]',
      current: true,
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
    }])),
  })
})

afterAll(() => {
  collectionSpy.mockRestore()
})

describe('runtime State Storage V2 repository', () => {
  test('loads control through a projection that excludes framework_state', async () => {
    const control = await getRuntimeStateControl({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })

    expect(control).toMatchObject({
      id: RUNTIME_ID,
      runtimeInstanceKey: 'runtime-one',
      stateVersion: 'runtime-revision:1',
      source: 'runtime_state_v2.control_projection',
    })
    expect(control.readReceipt).toEqual({
      source: 'runtime_state_v2.control_projection',
      serializedPayloadBytes: expect.any(Number),
      maxSerializedPayloadBytes: RUNTIME_STATE_V2_MAX_SERIALIZED_READ_BYTES,
      bounded: true,
      fullLegacyFrameworkStateFetched: false,
    })
    expect(getRuntimeInstance).toHaveBeenCalledWith(expect.objectContaining({
      runtimeInstanceId: RUNTIME_ID,
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      maxTimeMS: RUNTIME_STATE_V2_READ_MAX_TIME_MS,
      projection: RUNTIME_STATE_V2_CONTROL_PROJECTION,
    }))
    expect(RUNTIME_STATE_V2_CONTROL_PROJECTION).not.toContain('framework_state')
    expect(collectionSpy).not.toHaveBeenCalled()
  })

  test('loads renderer sections from current V2 rows with bounded section details', async () => {
    const section = {
      sectionKey: 'section_1_executive_summary',
      stateStatus: 'CURRENT',
      current: true,
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      sectionDetail: makeSectionDetail(),
    }
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, {
      find: jest.fn(() => makeCursor([section])),
    })

    const result = await getRuntimeStateRendererSections({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })

    expect(result).toMatchObject({
      sectionCount: 1,
      stateVersion: 'runtime-revision:1',
      sections: [{
        sectionKey: 'section_1_executive_summary',
        sectionDetail: makeSectionDetail(),
      }],
      readReceipt: expect.objectContaining({
        source: 'runtime_state_v2.renderer_sections',
        bounded: true,
        fullLegacyFrameworkStateFetched: false,
      }),
    })
    expect(collectionSpy).toHaveBeenCalledWith(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS)
  })

  test.each([
    [{}, 'missing scope'],
    [{ customer: { _id: CUSTOMER_ID } }, 'missing tenant'],
    [{ tenant: { _id: TENANT_ID } }, 'missing customer'],
    [{ customer: { _id: 'not-an-object-id' }, tenant: { _id: TENANT_ID } }, 'malformed customer'],
    [{ customer: { _id: CUSTOMER_ID }, tenant: { _id: TENANT_ID, customerId: '507f1f77bcf86cd799439099' } }, 'contradictory tenant customer'],
    [{ platformRoles: ['SUPER_ADMIN'] }, 'broad platform scope'],
  ])('fails closed before RuntimeInstance lookup for %s', async (scopes) => {
    await expect(getRuntimeStateControl({ scopes, runtimeInstanceId: RUNTIME_ID }))
      .rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.CONTROL_SCOPE_REQUIRED })
    expect(getRuntimeInstance).not.toHaveBeenCalled()
  })

  test('fails closed when the control identity is incomplete', async () => {
    getRuntimeInstance.mockResolvedValue(makeControl({ customerId: '' }))

    await expect(getRuntimeStateControl({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.CONTROL_INVALID })
  })

  test('fails closed when the control identity is malformed', async () => {
    getRuntimeInstance.mockResolvedValue(makeControl({ id: 'not-an-object-id' }))

    await expect(getRuntimeStateControl({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.CONTROL_INVALID })
  })

  test('fails closed when the control record is absent', async () => {
    getRuntimeInstance.mockResolvedValue(null)

    await expect(getRuntimeStateControl({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.CONTROL_INVALID })
  })

  test('fails closed when the control has no state version', async () => {
    getRuntimeInstance.mockResolvedValue(makeControl({ stateVersion: '', revision: { revisionNumber: 1 } }))

    await expect(getRuntimeStateControl({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MISSING })
  })

  test('accepts a legacy runtimeStateVersion as a read-only compatibility alias', async () => {
    getRuntimeInstance.mockResolvedValue(makeControl({
      stateVersion: undefined,
      runtimeStateVersion: 'legacy-runtime-state-v1',
    }))

    const control = await getRuntimeStateControl({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })

    expect(control.stateVersion).toBe('legacy-runtime-state-v1')
  })

  test('fails closed when explicit control state versions disagree', async () => {
    getRuntimeInstance.mockResolvedValue(makeControl({
      stateVersion: 'runtime-revision:1',
      runtimeStateVersion: 'runtime-revision:2',
    }))

    await expect(getRuntimeStateControl({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MIXED })
  })

  test('returns validated detail only for the bounded selected section', async () => {
    const find = jest.fn(() => makeCursor([{
      sectionKey: 'section_1_executive_summary',
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      truthStatus: 'ACCEPTED',
      truthHash: 'sha256:truth',
      summary: 'bounded summary',
      content: 'large content must not be returned',
      sectionDetail: makeSectionDetail(),
      evidenceRefs: [{ evidenceObjectId: 'evidence-1' }],
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    const result = await getRuntimeStateSectionSummary({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      sectionKey: 'section_1_executive_summary',
    })

    expect(result.section).toMatchObject({
      sectionKey: 'section_1_executive_summary',
      stateVersion: 'runtime-revision:1',
      summary: 'bounded summary',
      sectionDetail: expect.objectContaining({ input: 'Migrated section input' }),
    })
    expect(result.section).not.toHaveProperty('content')
    expect(result.source).toBe('runtime_state_v2.section_summary')
    expect(result.readReceipt).toEqual({
      source: 'runtime_state_v2.section_summary',
      serializedPayloadBytes: expect.any(Number),
      maxSerializedPayloadBytes: RUNTIME_STATE_V2_MAX_SERIALIZED_READ_BYTES,
      bounded: true,
      fullLegacyFrameworkStateFetched: false,
    })
    expect(JSON.stringify(result)).not.toMatch(/runtime_(?:instances|section_states|evidence_sources|evidence_objects|graph_snapshots)/)
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ $and: expect.any(Array) }),
      expect.objectContaining({
        projection: expect.any(Object),
        maxTimeMS: RUNTIME_STATE_V2_READ_MAX_TIME_MS,
      }),
    )
    expect(find.mock.calls[0][1].projection).toHaveProperty('sectionDetail', 1)
  })

  test('restores empty object fields minimized by stored V2 section documents', async () => {
    const minimizedDetail = makeSectionDetail()
    delete minimizedDetail.validation
    delete minimizedDetail.confidence
    delete minimizedDetail.additionalEvidence
    delete minimizedDetail.gsilContext
    const find = jest.fn(() => makeCursor([{
      sectionKey: 'section_1_executive_summary',
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      sectionDetail: minimizedDetail,
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    const result = await getRuntimeStateSectionSummary({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      sectionKey: 'section_1_executive_summary',
    })

    expect(result.section.sectionDetail).toMatchObject({
      validation: {},
      confidence: {},
      additionalEvidence: {},
      gsilContext: {},
    })
  })

  test('fails closed when selected-section detail is missing or invalid', async () => {
    const find = jest.fn(() => makeCursor([{
      sectionKey: 'section_1_executive_summary',
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      summary: 'bounded summary',
      sectionDetail: { input: 'incomplete detail' },
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    await expect(getRuntimeStateSectionSummary({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      sectionKey: 'section_1_executive_summary',
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_DETAIL_INVALID })
  })

  test('fails closed when selected-section detail exceeds the bounded payload limit', async () => {
    const find = jest.fn(() => makeCursor([{
      sectionKey: 'section_1_executive_summary',
      stateStatus: 'ACCEPTED',
      current: true,
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      summary: 'bounded summary',
      sectionDetail: makeSectionDetail({ input: 'x'.repeat((256 * 1024) + 1) }),
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    await expect(getRuntimeStateSectionSummary({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      sectionKey: 'section_1_executive_summary',
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_DETAIL_INVALID })
  })

  test('applies the direct-read maxTimeMS bound to V2 cursors', async () => {
    const cursor = makeCursor([{
      sectionKey: 'section_1_executive_summary',
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      summary: 'bounded summary',
      sectionDetail: makeSectionDetail(),
    }])
    const find = jest.fn(() => cursor)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    await getRuntimeStateSectionSummary({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      sectionKey: 'section_1_executive_summary',
    })

    expect(find.mock.calls[0][1]).toMatchObject({ maxTimeMS: RUNTIME_STATE_V2_READ_MAX_TIME_MS })
    expect(cursor.maxTimeMS).toHaveBeenCalledWith(RUNTIME_STATE_V2_READ_MAX_TIME_MS)
  })

  test('fails closed when a V2 cursor cannot apply maxTimeMS', async () => {
    const find = jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) }))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find })

    await expect(getRuntimeStateGraphManifest({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE })
  })

  test.each([
    ['limit', { sort: { updatedAt: -1 }, limit: 1 }],
    ['sort', { sort: { updatedAt: -1 }, limit: 1 }],
    ['skip', { sort: { updatedAt: -1 }, skip: 1, limit: 1 }],
  ])('fails closed when the requested cursor %s capability is unavailable', async (capability, options) => {
    const cursor = makeCursor([])
    delete cursor[capability]
    const find = jest.fn(() => cursor)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find })

    const graphRead = __testables.readMany({
      collectionName: RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS,
      filter: {},
      ...options,
    })

    await expect(graphRead).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE })
    expect(cursor.toArray).not.toHaveBeenCalled()
  })

  test('fails closed when a projected row exceeds the serialized read ceiling', async () => {
    const find = jest.fn(() => makeCursor([{
      sectionKey: 'section_1_executive_summary',
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      summary: 'x'.repeat(RUNTIME_STATE_V2_MAX_SERIALIZED_READ_BYTES),
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    await expect(getRuntimeStateSectionSummary({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      sectionKey: 'section_1_executive_summary',
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE })
  })

  test('fails closed when the selected section lacks a source-state receipt', async () => {
    const find = jest.fn(() => makeCursor([{
      sectionKey: 'section_1_executive_summary',
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    await expect(getRuntimeStateSectionSummary({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      sectionKey: 'section_1_executive_summary',
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MISSING })
  })

  test('sanitizes nested section evidence references while preserving logical lineage', async () => {
    const find = jest.fn(() => makeCursor([{
      sectionKey: 'section_1_executive_summary',
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      sectionDetail: makeSectionDetail(),
      evidenceRefs: [{
        evidenceObjectId: 'evidence-1',
        source: 'runtime_evidence_objects',
        lineage: {
          logicalSource: 'framework_state.evidence_pack',
          canonicalSource: 'runtime_graph_elements',
        },
      }],
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    const result = await getRuntimeStateSectionSummary({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      sectionKey: 'section_1_executive_summary',
    })

    expect(result.section.evidenceRefs).toEqual([{
      evidenceObjectId: 'evidence-1',
      lineage: {
        logicalSource: 'framework_state.evidence_pack',
      },
    }])
    expect(JSON.stringify(result)).not.toMatch(/runtime_(?:instances|section_states|evidence_sources|evidence_objects|graph_snapshots|graph_elements)/)
  })

  test('rejects unsafe logical section keys before touching V2 storage', async () => {
    await expect(getRuntimeStateSectionSummary({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      sectionKey: 'framework_state.sections.$where',
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.INVALID_SECTION_KEY })
    expect(collectionSpy).not.toHaveBeenCalled()
  })

  test('rejects unbounded evidence pages before touching V2 storage', async () => {
    await expect(listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 1,
      pageSize: 51,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.INVALID_PAGE })
    expect(collectionSpy).not.toHaveBeenCalled()

    await expect(listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 1001,
      pageSize: 1,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.INVALID_PAGE })
    expect(collectionSpy).not.toHaveBeenCalled()
  })

  test('fails closed on mixed evidence state versions', async () => {
    const find = jest.fn(() => makeCursor([
      { evidenceObjectId: 'evidence-1', stateVersion: 'runtime-revision:1', sourceStateVersion: 'runtime-revision:1' },
      { evidenceObjectId: 'evidence-2', stateVersion: 'runtime-revision:2', sourceStateVersion: 'runtime-revision:2' },
    ]))
    const countDocuments = jest.fn().mockResolvedValue(2)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, { find, countDocuments })

    await expect(listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 1,
      pageSize: 2,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MIXED })
  })

  test('returns a bounded current section catalogue from the bootstrap read', async () => {
    const find = jest.fn(() => makeCursor([
      {
        sectionKey: 'section_b',
        stateStatus: 'ACCEPTED',
        current: true,
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:1',
        truthStatus: 'ACCEPTED',
        summary: 'second section',
        content: 'full content must not be returned',
      },
      {
        sectionKey: 'section_a',
        stateStatus: 'GENERATED',
        current: true,
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:1',
        truthStatus: 'GENERATED',
        summary: 'first section',
      },
    ]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    const result = await getRuntimeStateBootstrap({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })

    expect(result).toMatchObject({
      control: expect.objectContaining({ stateVersion: 'runtime-revision:1' }),
      sectionCount: 2,
      stateVersion: 'runtime-revision:1',
      source: 'runtime_state_v2.bootstrap',
    })
    expect(result.sections).toEqual([
      expect.objectContaining({ sectionKey: 'section_b', summary: 'second section' }),
      expect.objectContaining({ sectionKey: 'section_a', summary: 'first section' }),
    ])
    expect(result.sections[0]).not.toHaveProperty('content')
    expect(result.readReceipt).toEqual(expect.objectContaining({
      source: 'runtime_state_v2.bootstrap',
      bounded: true,
      fullLegacyFrameworkStateFetched: false,
    }))
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ $and: expect.any(Array) }),
      expect.objectContaining({
        projection: expect.any(Object),
        maxTimeMS: RUNTIME_STATE_V2_READ_MAX_TIME_MS,
      }),
    )
    expect(find.mock.calls[0][1].projection).not.toHaveProperty('sectionDetail')
    expect(find.mock.results[0].value.limit).toHaveBeenCalledWith(RUNTIME_STATE_V2_SECTION_CATALOGUE_LIMIT + 1)
  })

  test('fails closed when the bootstrap catalogue has mixed state versions', async () => {
    const find = jest.fn(() => makeCursor([
      {
        sectionKey: 'section_a',
        stateStatus: 'ACCEPTED',
        current: true,
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:1',
      },
      {
        sectionKey: 'section_b',
        stateStatus: 'GENERATED',
        current: true,
        stateVersion: 'runtime-revision:2',
        sourceStateVersion: 'runtime-revision:2',
      },
    ]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    await expect(getRuntimeStateBootstrap({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID }))
      .rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MIXED })
  })

  test('fails closed when the bootstrap catalogue contains duplicate logical sections', async () => {
    const find = jest.fn(() => makeCursor([
      {
        sectionKey: 'section_a',
        stateStatus: 'ACCEPTED',
        current: true,
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:1',
      },
      {
        sectionKey: 'SECTION_A',
        stateStatus: 'GENERATED',
        current: true,
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:1',
      },
    ]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    await expect(getRuntimeStateBootstrap({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID }))
      .rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_DUPLICATE })
  })

  test('fails closed when a bootstrap section lacks the canonical current marker', async () => {
    const find = jest.fn(() => makeCursor([{
      sectionKey: 'section_a',
      stateStatus: 'ACCEPTED',
      current: false,
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    await expect(getRuntimeStateBootstrap({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID }))
      .rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_CURRENTNESS_INVALID })
  })

  test('limits evidence page and bounded count reads to current rows', async () => {
    const find = jest.fn(() => makeCursor([{
      evidenceObjectId: 'evidence-current',
      sourceId: 'source-1',
      current: true,
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
    }]))
    const countDocuments = jest.fn().mockResolvedValue(1)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, { find, countDocuments })

    await listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 1,
      pageSize: 1,
    })

    const filter = find.mock.calls[0][0]
    expect(filter).toEqual(expect.objectContaining({
      $or: [
        { stateStatus: 'CURRENT' },
        { status: 'CURRENT' },
        { current: true },
        { isCurrent: true },
      ],
    }))
    expect(countDocuments).toHaveBeenCalledWith(
      filter,
      expect.objectContaining({
        maxTimeMS: RUNTIME_STATE_V2_READ_MAX_TIME_MS,
        limit: RUNTIME_STATE_V2_EVIDENCE_COUNT_LIMIT,
      }),
    )
  })

  test('returns the bounded customer-safe evidence fields needed by the Runtime Workspace', async () => {
    const find = jest.fn(() => makeCursor([{
      evidenceObjectId: 'evidence-current',
      sourceId: 'source-1',
      lineageRef: 'framework_state.evidence_pack.evidenceObjects[0]',
      sourceType: 'WEBSITE',
      extractedFact: 'A bounded extracted fact.',
      validationStatus: 'VALID',
      confidence: { level: 'HIGH', score: 0.9, basis: ['source-backed'] },
      materiality: 'HIGH',
      materialityScore: 0.8,
      title: 'Customer problem',
      summary: 'A bounded summary.',
      reviewStatus: 'PENDING',
      acceptanceState: 'ELIGIBLE',
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
    }]))
    const countDocuments = jest.fn().mockResolvedValue(1)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, { find, countDocuments })

    const result = await listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 1,
      pageSize: 1,
    })

    expect(result.evidenceObjects).toEqual([expect.objectContaining({
      evidenceObjectId: 'evidence-current',
      sourceId: 'source-1',
      lineageRef: 'framework_state.evidence_pack.evidenceObjects[0]',
      sourceType: 'WEBSITE',
      extractedFact: 'A bounded extracted fact.',
      validationStatus: 'VALID',
      confidence: { level: 'HIGH', score: 0.9, basis: ['source-backed'] },
      materiality: 'HIGH',
      materialityScore: 0.8,
      title: 'Customer problem',
      summary: 'A bounded summary.',
    })])
    expect(result.sourceRegistry).toEqual([expect.objectContaining({
      sourceId: 'source-1',
      sourceType: 'WEBSITE',
      label: 'Customer website',
      url: 'https://acme.example',
      acquisitionStatus: 'ACQUIRED',
      stateVersion: 'runtime-revision:1',
    })])
    expect(result.lineage.sources).toEqual(result.sourceRegistry)
    const sourceFind = collections.get(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_SOURCES).find
    expect(sourceFind).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: { $in: ['source-1'] } }),
      expect.objectContaining({ maxTimeMS: RUNTIME_STATE_V2_READ_MAX_TIME_MS }),
    )
    expect(JSON.stringify(result)).not.toMatch(/runtime_(?:instances|section_states|evidence_sources|evidence_objects|graph_snapshots|graph_elements)/)
  })

  test('fails closed when page evidence does not have matching current source lineage', async () => {
    const find = jest.fn(() => makeCursor([{
      evidenceObjectId: 'evidence-current',
      sourceId: 'missing-source',
      current: true,
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
    }]))
    const countDocuments = jest.fn().mockResolvedValue(1)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, { find, countDocuments })
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_SOURCES, {
      find: jest.fn().mockReturnValue(makeCursor([])),
    })

    await expect(listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 1,
      pageSize: 1,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_SOURCE_MISSING })
  })

  test('fails closed when an evidence source has contradictory currentness markers', async () => {
    const find = jest.fn(() => makeCursor([{
      evidenceObjectId: 'evidence-current',
      sourceId: 'source-1',
      current: true,
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
    }]))
    const countDocuments = jest.fn().mockResolvedValue(1)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, { find, countDocuments })
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_SOURCES, {
      find: jest.fn().mockReturnValue(makeCursor([{
        sourceId: 'source-1',
        sourceType: 'WEBSITE',
        current: false,
        stateStatus: 'CURRENT',
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:1',
      }])),
    })

    await expect(listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 1,
      pageSize: 1,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_SOURCE_CURRENTNESS_INVALID })
  })

  test('fails closed when an evidence object lacks a source-state receipt', async () => {
    const find = jest.fn(() => makeCursor([{
      evidenceObjectId: 'evidence-1',
      sourceId: 'source-1',
      stateVersion: 'runtime-revision:1',
    }]))
    const countDocuments = jest.fn().mockResolvedValue(1)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, { find, countDocuments })

    await expect(listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 1,
      pageSize: 1,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MISSING })
  })

  test('returns an explicit receipt for an empty non-first evidence page', async () => {
    const find = jest.fn(() => makeCursor([]))
    const countDocuments = jest.fn().mockResolvedValue(3)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, { find, countDocuments })

    const result = await listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 2,
      pageSize: 2,
    })

    expect(result.evidenceObjects).toEqual([])
    expect(result.pageReceipt).toMatchObject({
      type: 'RUNTIME_STATE_V2_EVIDENCE_PAGE',
      result: 'EMPTY_PAGE',
      page: 2,
      stateVersion: 'runtime-revision:1',
      total: 3,
    })
    expect(countDocuments).toHaveBeenCalledWith(
      expect.any(Object),
      {
        maxTimeMS: RUNTIME_STATE_V2_READ_MAX_TIME_MS,
        limit: RUNTIME_STATE_V2_EVIDENCE_COUNT_LIMIT,
      },
    )
    expect(result.source).toBe('runtime_state_v2.evidence_page')
    expect(result.readReceipt).toEqual({
      source: 'runtime_state_v2.evidence_page',
      serializedPayloadBytes: expect.any(Number),
      maxSerializedPayloadBytes: RUNTIME_STATE_V2_MAX_SERIALIZED_READ_BYTES,
      bounded: true,
      fullLegacyFrameworkStateFetched: false,
    })
  })

  test('returns an explicit capped-count receipt without an unbounded count', async () => {
    const find = jest.fn(() => makeCursor([{
      evidenceObjectId: 'evidence-1',
      sourceId: 'source-1',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      createdAt: new Date('2026-08-22T00:00:00.000Z'),
    }]))
    const countDocuments = jest.fn().mockResolvedValue(RUNTIME_STATE_V2_EVIDENCE_COUNT_LIMIT)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, { find, countDocuments })

    const result = await listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 1,
      pageSize: 1,
    })

    expect(result).toMatchObject({
      total: RUNTIME_STATE_V2_EVIDENCE_COUNT_LIMIT,
      totalCapped: true,
      countLimit: RUNTIME_STATE_V2_EVIDENCE_COUNT_LIMIT,
    })
    expect(countDocuments.mock.calls[0][1]).toEqual({
      maxTimeMS: RUNTIME_STATE_V2_READ_MAX_TIME_MS,
      limit: RUNTIME_STATE_V2_EVIDENCE_COUNT_LIMIT,
    })
  })

  test('fails closed when bounded evidence counting is unavailable', async () => {
    const find = jest.fn(() => makeCursor([{
      evidenceObjectId: 'evidence-1',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, { find })

    await expect(listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 1,
      pageSize: 1,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE })
  })

  test('fails closed when the first evidence page is empty despite a positive count', async () => {
    const find = jest.fn(() => makeCursor([]))
    const countDocuments = jest.fn().mockResolvedValue(3)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, { find, countDocuments })

    await expect(listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 1,
      pageSize: 2,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_MISSING })
  })

  test('fails closed when the graph manifest is stale', async () => {
    const find = jest.fn(() => makeCursor([{
      snapshotId: 'snapshot-1',
      status: 'STALE',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      graphVersion: '2.2',
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find })

    await expect(getRuntimeStateGraphManifest({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_NOT_CURRENT })
  })

  test('fails closed when the graph source version differs from the selected version', async () => {
    const find = jest.fn(() => makeCursor([{
      snapshotId: 'snapshot-1',
      status: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:0',
      graphVersion: '2.2',
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find })

    await expect(getRuntimeStateGraphManifest({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MIXED })
  })

  test('returns the graph source-state receipt for a current manifest', async () => {
    const find = jest.fn(() => makeCursor([{
      snapshotId: 'snapshot-1',
      stateStatus: 'CURRENT',
      sourceStateVersion: 'runtime-revision:1',
      sourceHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      graphVersion: '2.2',
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find })

    const result = await getRuntimeStateGraphManifest({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })

    expect(result.manifest).toMatchObject({
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      sourceHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'CURRENT',
    })
    expect(result.source).toBe('runtime_state_v2.graph_manifest')
    expect(result.readReceipt).toEqual({
      source: 'runtime_state_v2.graph_manifest',
      serializedPayloadBytes: expect.any(Number),
      maxSerializedPayloadBytes: RUNTIME_STATE_V2_MAX_SERIALIZED_READ_BYTES,
      bounded: true,
      fullLegacyFrameworkStateFetched: false,
    })
  })

  test('returns a bounded current V2 graph projection with deterministic edge and endpoint reads', async () => {
    const snapshotFind = jest.fn(() => makeCursor([{
      snapshotId: 'snapshot-1',
      current: true,
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      sourceHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      graphVersion: '2.2',
      graphHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      counts: { nodeCount: 10, edgeCount: 20 },
      metadata: {
        artifactType: 'runtime-intelligence-graph',
        health: { state: 'HEALTHY' },
      },
    }]))
    const edgeCursor = makeCursor([{
      snapshotId: 'snapshot-1',
      graphVersion: '2.2',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      elementType: 'EDGE',
      elementKey: 'edge-1',
      fromElementKey: 'node-1',
      toElementKey: 'node-2',
      relationshipType: 'SOURCE_PRODUCES_EVIDENCE',
      attributes: { relationshipDisplayName: 'Source Produces Evidence', customerVisible: true },
    }])
    const nodeCursor = makeCursor([
      {
        snapshotId: 'snapshot-1',
        graphVersion: '2.2',
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:1',
        elementType: 'NODE',
        elementKey: 'node-1',
        label: 'Website source',
        attributes: { nodeType: 'SOURCE', entityDisplayName: 'Source' },
      },
      {
        snapshotId: 'snapshot-1',
        graphVersion: '2.2',
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:1',
        elementType: 'NODE',
        elementKey: 'node-2',
        label: 'Evidence',
        attributes: { nodeType: 'EVIDENCE', entityDisplayName: 'Evidence' },
      },
    ])
    const elementFind = jest.fn()
      .mockReturnValueOnce(edgeCursor)
      .mockReturnValueOnce(nodeCursor)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find: snapshotFind })
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_ELEMENTS, { find: elementFind })

    const result = await getRuntimeStateGraphProjection({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })

    expect(result.graph).toMatchObject({
      available: true,
      graphVersion: '2.2',
      totalNodeCount: 10,
      totalEdgeCount: 20,
      projection: { truncated: true, edgeLimit: 48, nodeLimit: 96 },
      nodes: [
        { nodeId: 'node-1', nodeType: 'SOURCE' },
        { nodeId: 'node-2', nodeType: 'EVIDENCE' },
      ],
      edges: [{
        edgeId: 'edge-1',
        edgeType: 'SOURCE_PRODUCES_EVIDENCE',
        fromNodeId: 'node-1',
        toNodeId: 'node-2',
      }],
    })
    expect(edgeCursor.sort).toHaveBeenCalledWith({ relationshipType: 1, elementKey: 1 })
    expect(edgeCursor.limit).toHaveBeenCalledWith(RUNTIME_STATE_V2_GRAPH_EDGE_LIMIT)
    expect(elementFind.mock.calls[0][0]).toMatchObject({
      snapshotId: 'snapshot-1',
      graphVersion: '2.2',
      stateVersion: 'runtime-revision:1',
      elementType: 'EDGE',
    })
    expect(JSON.stringify(elementFind.mock.calls[0][0])).toContain(CUSTOMER_ID)
    expect(JSON.stringify(elementFind.mock.calls[0][0])).toContain(TENANT_ID)
    expect(result.readReceipt).toMatchObject({
      source: 'runtime_state_v2.graph_projection',
      bounded: true,
      fullLegacyFrameworkStateFetched: false,
    })
    expect(JSON.stringify(result)).not.toMatch(/runtime_(?:instances|section_states|evidence_sources|evidence_objects|graph_snapshots|graph_elements)/)
  })

  test('fails closed when a bounded graph edge endpoint is missing', async () => {
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, {
      find: jest.fn(() => makeCursor([{
        snapshotId: 'snapshot-1',
        current: true,
        stateStatus: 'CURRENT',
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:1',
        sourceHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        graphVersion: '2.2',
        counts: { nodeCount: 2, edgeCount: 1 },
      }])),
    })
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_ELEMENTS, {
      find: jest.fn()
        .mockReturnValueOnce(makeCursor([{
          snapshotId: 'snapshot-1',
          graphVersion: '2.2',
          stateVersion: 'runtime-revision:1',
          sourceStateVersion: 'runtime-revision:1',
          elementType: 'EDGE',
          elementKey: 'edge-1',
          fromElementKey: 'node-1',
          toElementKey: 'node-missing',
          relationshipType: 'SOURCE_PRODUCES_EVIDENCE',
        }]))
        .mockReturnValueOnce(makeCursor([{
          snapshotId: 'snapshot-1',
          graphVersion: '2.2',
          stateVersion: 'runtime-revision:1',
          sourceStateVersion: 'runtime-revision:1',
          elementType: 'NODE',
          elementKey: 'node-1',
          attributes: { nodeType: 'SOURCE' },
        }])),
    })

    await expect(getRuntimeStateGraphProjection({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_ELEMENTS_INVALID })
  })

  test('fails closed when a current graph manifest has incomplete graph identity', async () => {
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, {
      find: jest.fn(() => makeCursor([{
        current: true,
        stateStatus: 'CURRENT',
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:1',
        sourceHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        graphVersion: '2.2',
      }])),
    })

    await expect(getRuntimeStateGraphManifest({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_IDENTITY_INVALID })
  })

  test('fails closed when graph elements carry a mixed source-state version', async () => {
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, {
      find: jest.fn(() => makeCursor([{
        snapshotId: 'snapshot-1',
        current: true,
        stateStatus: 'CURRENT',
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:1',
        sourceHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        graphVersion: '2.2',
        counts: { nodeCount: 2, edgeCount: 1 },
      }])),
    })
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_ELEMENTS, {
      find: jest.fn(() => makeCursor([{
        snapshotId: 'snapshot-1',
        graphVersion: '2.2',
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:2',
        elementType: 'EDGE',
        elementKey: 'edge-1',
        fromElementKey: 'node-1',
        toElementKey: 'node-2',
        relationshipType: 'SOURCE_PRODUCES_EVIDENCE',
      }])),
    })

    await expect(getRuntimeStateGraphProjection({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_ELEMENTS_INVALID })
  })

  test.each([
    ['missing', undefined],
    ['malformed', 'sha256:not-a-digest'],
  ])('fails closed when a current graph manifest has a %s source hash', async (_label, sourceHash) => {
    const find = jest.fn(() => makeCursor([{
      snapshotId: 'snapshot-1',
      stateStatus: 'CURRENT',
      sourceStateVersion: 'runtime-revision:1',
      ...(sourceHash === undefined ? {} : { sourceHash }),
      graphVersion: '2.2',
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find })

    await expect(getRuntimeStateGraphManifest({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_SOURCE_HASH_INVALID })
  })

  test('sanitizes nested graph counts while preserving bounded logical counts', async () => {
    const find = jest.fn(() => makeCursor([{
      snapshotId: 'snapshot-1',
      status: 'CURRENT',
      sourceStateVersion: 'runtime-revision:1',
      sourceHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      graphVersion: '2.2',
      counts: {
        nodes: 3,
        edges: 2,
        sources: [{
          count: 1,
          logicalSource: 'framework_state.intelligence_graph',
          source: 'runtime_graph_elements',
        }],
        runtime_graph_elements: 99,
      },
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find })

    const result = await getRuntimeStateGraphManifest({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })

    expect(result.manifest.counts).toEqual({
      nodes: 3,
      edges: 2,
      sources: [{
        count: 1,
        logicalSource: 'framework_state.intelligence_graph',
      }],
    })
    expect(JSON.stringify(result)).not.toMatch(/runtime_(?:instances|section_states|evidence_sources|evidence_objects|graph_snapshots|graph_elements)/)
  })

  test('fails closed when graph source-state receipt is missing', async () => {
    const find = jest.fn(() => makeCursor([{
      snapshotId: 'snapshot-1',
      status: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      graphVersion: '2.2',
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find })

    await expect(getRuntimeStateGraphManifest({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MISSING })
  })

  test('fails closed on contradictory graph currentness flags', async () => {
    const find = jest.fn(() => makeCursor([{
      snapshotId: 'snapshot-1',
      status: 'STALE',
      current: true,
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      graphVersion: '2.2',
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find })

    await expect(getRuntimeStateGraphManifest({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_NOT_CURRENT })
  })

  test.each([
    ['missing status', {}],
    ['superseded status', { status: 'SUPERSEDED' }],
  ])('fails closed when graph current=true has %s', async (_label, statusFields) => {
    const find = jest.fn(() => makeCursor([{
      snapshotId: 'snapshot-1',
      ...statusFields,
      current: true,
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      graphVersion: '2.2',
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find })

    await expect(getRuntimeStateGraphManifest({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_NOT_CURRENT })
  })

  test('fails closed when graph status fields disagree', async () => {
    const find = jest.fn(() => makeCursor([{
      snapshotId: 'snapshot-1',
      status: 'CURRENT',
      stateStatus: 'STALE',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      graphVersion: '2.2',
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find })

    await expect(getRuntimeStateGraphManifest({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_NOT_CURRENT })
  })

  test('does not expose physical collection names in storage errors', async () => {
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, {})

    const error = await getRuntimeStateSectionSummary({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      sectionKey: 'section_1_executive_summary',
    }).catch((caught) => caught)

    expect(error).toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE })
    expect(error.details).not.toHaveProperty('collection')
  })

  test('returns a governed blocked handoff projection without legacy state retrieval', async () => {
    const result = await getRuntimeStateOutcomeHandoffReadiness({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })

    expect(result.status).toBe('BLOCKED')
    expect(result.readReceipt).toMatchObject({
      source: 'runtime_state_v2.bounded_handoff_projection',
      serializedPayloadBytes: expect.any(Number),
      maxSerializedPayloadBytes: RUNTIME_STATE_V2_MAX_SERIALIZED_READ_BYTES,
      bounded: true,
      fullLegacyFrameworkStateFetched: false,
    })
    expect(Object.keys(result.readReceipt).sort()).toEqual([
      'bounded',
      'fullLegacyFrameworkStateFetched',
      'maxSerializedPayloadBytes',
      'serializedPayloadBytes',
      'source',
    ])
    expect(result.handoff).toBeDefined()
    expect(resolveFrameworkOutcomeStudioHandoff).toHaveBeenCalledWith(expect.objectContaining({
      runtimeInstance: expect.objectContaining({
        id: RUNTIME_ID,
        stateVersion: 'runtime-revision:1',
      }),
      boundedDependencyPolicy: expect.objectContaining({
        policyVersion: FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_READ_POLICY.policyVersion,
      }),
      boundedStateParityReceipt: {
        contractVersion: FRAMEWORK_OUTCOME_HANDOFF_V2_PARITY_CONTRACT_VERSION,
        stateVersion: 'runtime-revision:1',
        sectionCount: 0,
        evidenceObjectCount: 0,
        sectionKeys: [],
        stateDigest: 'sha256:bounded-state-digest',
      },
    }))
    expect(resolveFrameworkOutcomeStudioHandoff.mock.calls[0][0].runtimeInstance.framework_state).toEqual({
      lock: {},
      publish: {},
      sections: {},
      evidence_pack: { evidenceObjects: [] },
    })
    expect(result.control).not.toHaveProperty('handoffFrameworkState')
  })

  test('sanitizes delegated handoff diagnostics at the repository boundary', async () => {
    resolveFrameworkOutcomeStudioHandoff.mockResolvedValueOnce({
      handoff: {
        status: 'BLOCKED',
        reason: {
          code: 'HANDOFF_RESOLUTION_FAILED',
          detail: 'database collection runtime_graph_elements is unavailable',
        },
        source: 'runtime_graph_elements',
        metadata: {
          canonicalSource: 'runtime_graph_elements',
          error: [{ reason: 'provider timeout in runtime_graph_elements' }],
          details: [{
            reason: 'Mongo collection runtime_evidence_objects failed',
            detail: { message: 'socket timeout in runtime_graph_elements' },
          }],
        },
        contradictions: [{
          code: 'HANDOFF_RESOLUTION_FAILED',
          severity: 'ERROR',
          canonicalSource: 'runtime_evidence_objects',
          message: { detail: 'Mongo collection runtime_evidence_objects failed: provider timeout' },
        }],
      },
    })

    const result = await getRuntimeStateOutcomeHandoffReadiness({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })

    expect(result.handoff.contradictions[0]).toMatchObject({
      code: 'HANDOFF_RESOLUTION_FAILED',
      severity: 'ERROR',
    })
    expect(JSON.stringify(result.handoff.contradictions[0].message)).not.toMatch(/Mongo|runtime_evidence_objects|provider timeout/i)
    expect(result.handoff.contradictions[0]).not.toHaveProperty('canonicalSource')
    expect(JSON.stringify(result)).not.toMatch(/runtime_(?:instances|section_states|evidence_sources|evidence_objects|graph_snapshots)/)
    expect(result.handoff).not.toHaveProperty('source')
    expect(result.handoff.reason).toEqual({
      code: 'HANDOFF_RESOLUTION_FAILED',
      detail: 'Additional handoff diagnostic detail is withheld by the bounded read contract.',
    })
    expect(result.handoff.metadata).not.toHaveProperty('canonicalSource')
    expect(result.handoff.metadata.error).toEqual([{
      reason: 'Additional handoff diagnostic detail is withheld by the bounded read contract.',
    }])
    expect(result.handoff.metadata.details).toEqual([{
      reason: 'Additional handoff diagnostic detail is withheld by the bounded read contract.',
      detail: {
        message: 'Additional handoff diagnostic detail is withheld by the bounded read contract.',
      },
    }])
    expect(result.handoff.contradictions[0].message).toEqual({
      detail: 'Additional handoff diagnostic detail is withheld by the bounded read contract.',
    })
  })

  test('fails closed when the final handoff result exceeds the serialized read ceiling', async () => {
    resolveFrameworkOutcomeStudioHandoff.mockResolvedValueOnce({
      handoff: {
        status: 'BLOCKED',
        contradictions: Array.from({ length: 100000 }, () => ({ code: 'HANDOFF_BLOCKED' })),
      },
    })

    await expect(getRuntimeStateOutcomeHandoffReadiness({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE })
  })
})
