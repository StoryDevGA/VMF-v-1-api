import { storedControlledReplayBindingDigest } from '../services/controlledReplayContract.js'
import { createHash } from 'node:crypto'

import { describe, expect, test } from '@jest/globals'
import mongoose from 'mongoose'
import { applyDiscoveryEvidenceReview, ingestUploadedDocumentDiscoveryEvidence, normalizeDiscoveryEvidenceObjects,
  buildDiscoverySourceRegistry } from '../services/discoveryIntelligenceService.js'
import { buildRuntimeSectionEvidenceQualifications } from '../services/runtimeSectionEvidenceQualificationService.js'
import { evidenceMaterialHash } from '../services/runtimeEvidenceSnapshotContract.js'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import { buildRuntimeIntelligenceGraphForFrameworkState } from '../services/runtimeIntelligenceGraphService.js'

import {
  RUNTIME_STATE_V2_MAPPING_ERROR_CODES,
  createRuntimeStateLegacySourceRowSet,
  createRuntimeStateLegacyRowSet,
} from '../services/runtimeStateLegacyMapper.js'
import {
  RUNTIME_STATE_V2_CANONICAL_ALGORITHM,
  RUNTIME_STATE_V2_CANONICAL_ERROR_CODES,
  createRuntimeStateCanonicalMappingManifest,
} from '../services/runtimeStateCanonicalSerializer.js'

const hash = (character) => `sha256:${character.repeat(64)}`

test('trusted section projection changes only typed detail while full canonical source hashes stay exact', () => {
  const input = makeInput(), original = JSON.stringify(input)
  const plain = createRuntimeStateLegacySourceRowSet(input)
  const projected = createRuntimeStateLegacySourceRowSet(input, { sectionDetailProjector: detail => ({
    ...detail, metrics: { ...detail.metrics, projectionWitness: true },
  }) })
  expect(projected.sourceSetHash).toBe(plain.sourceSetHash)
  expect(projected.rows.sections.map(row => row.sourceHash)).toEqual(plain.rows.sections.map(row => row.sourceHash))
  expect(projected.rows.sections.every(row => row.sectionDetail.metrics.projectionWitness)).toBe(true)
  expect(JSON.stringify(input)).toBe(original)
})
const stateVersion = 'rsv2:123e4567-e89b-42d3-a456-426614174000'
const migrationTimestamp = '2026-08-26T12:00:00.000Z'

const makeLegacy = (overrides = {}) => ({
  rawBsonBytes: 4096,
  sections: {
    accepted: {
      accepted: {
        summary: ' Accepted summary ',
        truthStatus: 'certified',
        truthHash: hash('a'),
        contentHash: hash('b'),
        evidenceRefs: [' evidence-1 '],
      },
      generated: { summary: 'not selected' },
    },
    generated: { accepted: null, generated: { summary: ' Generated summary ', status: 'draft' } },
    legacy: { review: { status: 'PENDING' } },
  },
  evidencePack: {
    sourceRegistry: [{
      sourceId: 'source-1',
      sourceType: 'website',
      title: ' Primary source ',
      label: 'lower precedence',
      url: ' https://example.test/source ',
      sourceHash: hash('c'),
      acquisitionStatus: 'complete',
      acquisitionProfile: ' web-v1 ',
      lineage: ' source://lineage ',
      reviewStatus: 'accepted',
    }],
    evidenceObjects: [{
      evidenceObjectId: 'evidence-1',
      sourceId: 'source-1',
      sourceType: 'website',
      fact: ' Fact ',
      confidence: { level: 'high', score: 0.9, basis: [' corroborated '] },
      materiality: 'material',
      materialityScore: 0.8,
      validationStatus: 'validated',
      reviewStatus: 'accepted',
      acceptanceState: 'accepted',
      title: ' Evidence ',
      summary: ' Summary ',
      contentHash: hash('d'),
    }],
  },
  intelligenceGraph: {
    graphVersion: ' graph-v1 ',
    graphHash: hash('e'),
    counts: { nodeCount: 2, edgeCount: 1 },
    nodeCount: 2,
    edgeCount: 1,
    artifactType: 'intelligence-graph',
    scope: { frameworkId: 'framework-1', runtimeId: 'runtime-one' },
    nodes: [
      { id: 'node-2', label: ' Node 2 ', nodeType: 'company' },
      { nodeId: 'node-1', label: ' Node 1 ', sectionKey: 'accepted', metadata: { rank: 1 } },
    ],
    edges: [{
      id: 'edge-1',
      from: 'node-1',
      to: 'node-2',
      relationshipType: 'supports',
      relation: 'ignored-lower-precedence',
      basis: ['evidence-1'],
    }],
  },
  ...overrides,
})

const makeInput = (legacyInput = makeLegacy(), overrides = {}) => ({
  legacyInput,
  scope: {
    runtimeInstanceId: '64b7f7a4e1e5f8320c000001',
    runtimeInstanceKey: ' Runtime-One ',
    customerId: '64b7f7a4e1e5f8320c000002',
    tenantId: '64b7f7a4e1e5f8320c000003',
  },
  stateVersion,
  migrationReceiptId: '64b7f7a4e1e5f8320c000004',
  migrationTimestamp,
  ...overrides,
})

const capture = (callback) => {
  try {
    callback()
  } catch (error) {
    return error
  }
  throw new Error('Expected mapper failure.')
}

describe('Accepted section-truth graph producer through legacy mapping', () => {
  const produce = (acceptedOverrides = {}) => {
    const legacy = makeLegacy()
    Object.assign(legacy.sections.accepted.accepted, {
      acceptedAt: migrationTimestamp, acceptedBy: 'historical-reviewer', ...acceptedOverrides,
    })
    legacy.intelligenceGraph = buildRuntimeIntelligenceGraphForFrameworkState({
      runtimeInstance: { ...makeInput().scope, _id: makeInput().scope.runtimeInstanceId,
        runtimeType: 'VALUE_NARRATIVE', frameworkId: '64b7f7a4e1e5f8320c000005' },
      frameworkPackage: { frameworkKey: 'FIXTURE', packageKey: 'fixture', version: '1',
        sections: [{ sectionKey: 'accepted', runtimePath: 'framework_state.sections.accepted' }] },
      frameworkState: { sections: legacy.sections, evidence_pack: legacy.evidencePack },
      builtAt: migrationTimestamp,
    })
    return legacy
  }
  const truth = legacy => legacy.intelligenceGraph.nodes.find(node => node.nodeType === 'SECTION_TRUTH')

  test('preserves real producer lineage, original canonical hashes and all five row families', () => {
    const legacy = produce(), before = JSON.stringify(legacy)
    const canonical = createRuntimeStateCanonicalMappingManifest(legacy).serializerResult
    const result = createRuntimeStateLegacyRowSet(makeInput(legacy))
    const node = result.rows.graphElements.find(row => row.elementKey === truth(legacy).nodeId)
    expect(node.attributes).toMatchObject({ truthHash: hash('a'), acceptedAt: migrationTimestamp,
      acceptedBy: 'historical-reviewer', nodeType: 'SECTION_TRUTH' })
    expect(result.rows.graphSnapshots[0].sourceHash).toBe(canonical.domains.intelligenceGraph.sourceHash)
    expect(node.sourceHash).toBe(canonical.domains.intelligenceGraph.sourceHash)
    expect(result.sourceSetHash).toBe(canonical.sourceSetHash)
    for (const family of ['sections', 'evidenceSources', 'evidenceObjects', 'graphSnapshots', 'graphElements']) {
      expect(result.rows[family].length).toBeGreaterThan(0)
    }
    expect(JSON.stringify(legacy)).toBe(before)
  })

  test.each([
    ['time-only', { truthHash: '', contentHash: '', acceptedBy: '' }, '', migrationTimestamp, ''],
    ['hash-only', { acceptedAt: '', acceptedBy: '' }, hash('a'), null, ''],
    ['native Date', { acceptedAt: new Date(migrationTimestamp) }, hash('a'), migrationTimestamp, 'historical-reviewer'],
  ])('preserves %s producer values without manufacturing lineage', (_name, overrides, truthHash, acceptedAt, acceptedBy) => {
    const legacy = produce(overrides)
    const result = createRuntimeStateLegacyRowSet(makeInput(legacy))
    const node = result.rows.graphElements.find(row => row.elementKey === truth(legacy).nodeId)
    expect(node.attributes).toMatchObject({ truthHash, acceptedAt, acceptedBy })
  })

  test('preserves an existing historical graph hash token without rewriting source material', () => {
    const legacy = produce()
    truth(legacy).truthHash = 'historical-hash-token'
    const result = createRuntimeStateLegacyRowSet(makeInput(legacy))
    expect(result.rows.graphElements.find(row => row.elementKey === truth(legacy).nodeId).attributes.truthHash)
      .toBe('historical-hash-token')
  })

  test.each([
    ['hash object', node => { node.truthHash = {} }],
    ['hash null', node => { node.truthHash = null }],
    ['actor object', node => { node.acceptedBy = {} }],
    ['actor null', node => { node.acceptedBy = null }],
    ['time object', node => { node.acceptedAt = {} }],
    ['time number', node => { node.acceptedAt = 123 }],
    ['time boolean', node => { node.acceptedAt = true }],
    ['time malformed', node => { node.acceptedAt = 'not-a-time' }],
    ['time empty', node => { node.acceptedAt = '' }],
    ['unknown fourth field', node => { node.acceptedReason = 'unowned' }],
    ['wrong node type', node => { node.nodeType = 'EVIDENCE' }],
    ['missing node type', node => { delete node.nodeType }],
  ])('rejects %s rather than dropping graph material', (_name, mutate) => {
    const legacy = produce()
    mutate(truth(legacy))
    const error = capture(() => createRuntimeStateLegacyRowSet(makeInput(legacy)))
    expect(error.code).toBe(RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID)
    expect(error.message).toBe('Node mapping is invalid.')
  })
})

describe('Source capture and support through actual native mapping and models', () => {
  const produce = () => ingestUploadedDocumentDiscoveryEvidence({ batchOutcomes: true, acquisitionProfile: 'STANDARD',
    capturedAt: migrationTimestamp, documentSources: [{ fileName: 'qualified.txt', mimeType: 'text/plain',
      textContent: 'The fictional pilot reviewer has not provided support and has not approved the trial.' }] })
  const native = product => createRuntimeStateLegacySourceRowSet(makeInput(makeLegacy({ evidencePack: {
    sourceRegistry: product.sourceRegistry, evidenceObjects: product.evidenceObjects,
  } })))
  test('maps real producer metadata and model validation without manufacturing defaults', async () => {
    const product = await produce(), result = native(product)
    const source = result.rows.evidenceSources[0], evidence = result.rows.evidenceObjects[0]
    expect(source.sourceCapture).toEqual(product.sourceRegistry[0].sourceCapture)
    expect(evidence.evidenceSupport).toEqual(product.evidenceObjects[0].evidenceSupport)
    expect(new RuntimeEvidenceSource(source).validateSync()).toBeUndefined()
    expect(new RuntimeEvidenceObject(evidence).validateSync()).toBeUndefined()
    const legacy = createRuntimeStateLegacySourceRowSet(makeInput())
    expect(Object.hasOwn(legacy.rows.evidenceSources[0], 'sourceCapture')).toBe(false)
    expect(Object.hasOwn(legacy.rows.evidenceObjects[0], 'evidenceSupport')).toBe(false)
  })
  test('rejects raw types before nested model casting and rejects local owner mismatch', async () => {
    const mapped = native(await produce()), source = mapped.rows.evidenceSources[0], evidence = mapped.rows.evidenceObjects[0]
    for (const mutate of [value => { value.textLength = '55' }, value => { value.captureReceipt.inputIndex = '0' },
      value => { value.adapter = 12 }, value => { value.sourceId = 'other' }]) {
      const changed = JSON.parse(JSON.stringify(source)); mutate(changed.sourceCapture)
      expect(new RuntimeEvidenceSource(changed).validateSync()).toBeDefined()
    }
    for (const mutate of [value => { value.start = String(value.start) }, value => { value.exactExcerpt = 55 },
      value => { value.sourceId = 'other' }]) {
      const changed = JSON.parse(JSON.stringify(evidence)); mutate(changed.evidenceSupport)
      expect(new RuntimeEvidenceObject(changed).validateSync()).toBeDefined()
    }
    const getter = () => { throw new Error('untrusted getter executed') }
    const changed = JSON.parse(JSON.stringify(source))
    Object.defineProperty(changed.sourceCapture, 'textLength', { get: getter, enumerable: true })
    expect(new RuntimeEvidenceSource(changed).validateSync()).toBeDefined()
  })
  test('requires the source-first admitted capture map rather than a copied-looking support receipt', async () => {
    const product = await produce(); delete product.sourceRegistry[0].sourceCapture
    expect(() => native(product)).toThrow()
    const changed = await produce(); changed.evidenceObjects[0].evidenceSupport.captureTextHash = hash('f')
    expect(() => native(changed)).toThrow()
    const original = await produce(), before = structuredClone(original)
    native(original)
    expect(original).toEqual(before)
  })
})

test.each(['source-1#page-2', { fieldPath: 'source.customer.name', page: 2 }])('preserves supplied source location and includes it in canonical evidence identity: %j', sourceLocation => {
  const legacy = makeLegacy()
  const baseline = createRuntimeStateLegacySourceRowSet(makeInput(legacy)).rows.evidenceObjects[0]
  legacy.evidencePack.evidenceObjects[0].sourceLocation = sourceLocation
  const located = createRuntimeStateLegacySourceRowSet(makeInput(legacy)).rows.evidenceObjects[0]
  expect(located.sourceLocation).toEqual(sourceLocation)
  expect(located.sourceHash).not.toBe(baseline.sourceHash)
  expect(baseline).not.toHaveProperty('sourceLocation')
})

test.each([42, ['invented-location'], 'x'.repeat(8193)])('rejects invalid or oversized source-location representation: %#', sourceLocation => {
  const legacy = makeLegacy()
  legacy.evidencePack.evidenceObjects[0].sourceLocation = sourceLocation
  expect(() => createRuntimeStateLegacySourceRowSet(makeInput(legacy))).toThrow()
})

const expectCode = (callback, code, reason) => {
  const error = capture(callback)
  expect(error.code).toBe(code)
  if (reason) expect(error.details.reason).toBe(reason)
  return error
}

const commonKeys = [
  'runtimeInstanceId', 'runtimeInstanceKey', 'customerId', 'tenantId',
  'stateVersion', 'sourceStateVersion', 'sourceHash', 'migrationReceiptId',
  'current', 'createdAt', 'updatedAt',
]

test('maps an actual rejected discovery decision without inventing materiality or losing evidence', () => {
  const legacy = makeLegacy()
  const original = legacy.evidencePack.evidenceObjects[0]
  const reviewed = applyDiscoveryEvidenceReview({
    actorUserId: '64b7f7a4e1e5f8320c000005',
    evidenceObjectId: original.evidenceObjectId,
    evidenceObjects: [original],
    reviewStatus: 'REJECTED',
    reviewedAt: migrationTimestamp,
  })
  expect(reviewed.found).toBe(true)
  legacy.evidencePack.evidenceObjects = reviewed.evidenceObjects
  const rows = createRuntimeStateLegacySourceRowSet(makeInput(legacy)).rows.evidenceObjects
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    evidenceObjectId: 'evidence-1', sourceId: 'source-1', extractedFact: 'Fact',
    reviewStatus: 'REJECTED', validationStatus: 'REJECTED',
    materiality: 'UNKNOWN', materialityScore: null,
  })
})

test.each([['UNKNOWN', undefined], ['UNKNOWN', 0], ['MATERIAL', 0]])(
  'preserves valid materiality score boundaries: %s %s', (materiality, materialityScore) => {
    const legacy = makeLegacy()
    Object.assign(legacy.evidencePack.evidenceObjects[0], { materiality, materialityScore })
    if (materialityScore === undefined) delete legacy.evidencePack.evidenceObjects[0].materialityScore
    expect(createRuntimeStateLegacySourceRowSet(makeInput(legacy)).rows.evidenceObjects[0])
      .toMatchObject({ materiality, materialityScore })
  },
)

test.each([['MATERIAL', null], [undefined, null], ['UNKNOWN', '0'],
  ['UNKNOWN', NaN], ['UNKNOWN', Infinity], ['UNKNOWN', -0.1], ['UNKNOWN', 1.1]])(
  'rejects malformed materiality score despite unknown-score compatibility: %s %s',
  (materiality, materialityScore) => {
    const legacy = makeLegacy()
    Object.assign(legacy.evidencePack.evidenceObjects[0], { materiality, materialityScore })
    if (materiality === undefined) delete legacy.evidencePack.evidenceObjects[0].materiality
    expect(() => createRuntimeStateLegacySourceRowSet(makeInput(legacy))).toThrow()
  },
)

test('document mapping preserves explicit processing provenance and filename fallback without inferring a receipt', () => {
  const legacy = makeLegacy()
  const source = legacy.evidencePack.sourceRegistry[0]
  source.sourceType = 'UPLOADED_DOCUMENT'; delete source.url
  delete legacy.evidencePack.evidenceObjects[0].sourceType
  source.fileName = 'synthetic.txt'; source.contentHash = hash('c')
  source.processingReceipt = { contractVersion: 'document-processing-receipt.v1',
    runId: '123e4567-e89b-42d3-a456-426614174000', inputIndex: 0, contentHash: hash('c') }
  let row = createRuntimeStateLegacySourceRowSet(makeInput(legacy)).rows.evidenceSources[0]
  expect(row).toMatchObject({ sourceRef: 'synthetic.txt', contentHash: hash('c'), processingReceipt: source.processingReceipt })
  source.sourceRef = 'canonical-reference'
  expect(createRuntimeStateLegacySourceRowSet(makeInput(legacy)).rows.evidenceSources[0].sourceRef).toBe('canonical-reference')
  delete source.processingReceipt
  row = createRuntimeStateLegacySourceRowSet(makeInput(legacy)).rows.evidenceSources[0]
  expect(row).not.toHaveProperty('processingReceipt')
})

test.each(['null', 'extra', 'version', 'run', 'index', 'hash', 'kind'])('document mapper rejects malformed %s receipt', mode => {
  const legacy = makeLegacy(), source = legacy.evidencePack.sourceRegistry[0]
  source.sourceType = 'UPLOADED_DOCUMENT'
  delete legacy.evidencePack.evidenceObjects[0].sourceType
  source.processingReceipt = { contractVersion: 'document-processing-receipt.v1',
    runId: '123e4567-e89b-42d3-a456-426614174000', inputIndex: 0, contentHash: hash('c') }
  if (mode === 'null') source.processingReceipt = null
  if (mode === 'extra') source.processingReceipt.unknown = true
  if (mode === 'version') source.processingReceipt.contractVersion = 'unknown'
  if (mode === 'run') source.processingReceipt.runId = 'not-a-run'
  if (mode === 'index') source.processingReceipt.inputIndex = '0'
  if (mode === 'hash') source.processingReceipt.contentHash = 'wrong'
  if (mode === 'kind') source.sourceType = 'WEBSITE'
  expect(() => createRuntimeStateLegacySourceRowSet(makeInput(legacy))).toThrow()
})

const expectStringFields = (value, fields) => {
  for (const field of fields) expect(typeof value[field]).toBe('string')
}

describe('SS-014 pure legacy-to-V2 mapper', () => {
  test('projects section and evidence rollover rows without constructing graph rows', () => {
    const input = makeInput()
    const sourceResult = createRuntimeStateLegacySourceRowSet(input)
    const completeResult = createRuntimeStateLegacyRowSet(input)

    expect(sourceResult).toEqual({
      schemaVersion: 'ss014-v2-source-row-set-v1',
      algorithm: completeResult.algorithm,
      sourceSetHash: completeResult.sourceSetHash,
      stateVersion: completeResult.stateVersion,
      counts: {
        sectionCount: completeResult.counts.sectionCount,
        sourceCount: completeResult.counts.sourceCount,
        evidenceObjectCount: completeResult.counts.evidenceObjectCount,
      },
      rows: {
        sections: completeResult.rows.sections,
        evidenceSources: completeResult.rows.evidenceSources,
        evidenceObjects: completeResult.rows.evidenceObjects,
      },
    })
    expect(sourceResult.rows).not.toHaveProperty('graphSnapshots')
    expect(sourceResult.rows).not.toHaveProperty('graphElements')
  })

  test('emits exact deterministic plain DTO rows for all six row families', () => {
    const result = createRuntimeStateLegacyRowSet(makeInput())

    expect(Object.keys(result)).toEqual(['schemaVersion', 'algorithm', 'sourceSetHash', 'stateVersion', 'counts', 'rows'])
    expect(result.schemaVersion).toBe('ss014-v2-row-set-v1')
    expect(result.algorithm).toBe(RUNTIME_STATE_V2_CANONICAL_ALGORITHM)
    expect(typeof result.schemaVersion).toBe('string')
    expect(typeof result.algorithm).toBe('string')
    expect(typeof result.stateVersion).toBe('string')
    expect(typeof result.sourceSetHash).toBe('string')
    expect(result.sourceSetHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    const canonical = createRuntimeStateCanonicalMappingManifest(makeLegacy()).serializerResult
    expect(result.sourceSetHash).toBe(canonical.sourceSetHash)
    expect(result.counts).toEqual({
      sectionCount: 3,
      sourceCount: 1,
      evidenceObjectCount: 1,
      graphSnapshotCount: 1,
      graphNodeCount: 2,
      graphEdgeCount: 1,
    })
    for (const count of Object.values(result.counts)) expect(typeof count).toBe('number')

    const [section] = result.rows.sections
    const [source] = result.rows.evidenceSources
    const [evidence] = result.rows.evidenceObjects
    const [snapshot] = result.rows.graphSnapshots
    const [node] = result.rows.graphElements
    const edge = result.rows.graphElements.at(-1)
    expect(Object.keys(section)).toEqual([...commonKeys, 'sectionKey', 'legacyPath', 'stateStatus', 'truthStatus', 'truthHash', 'contentHash', 'summary', 'evidenceRefs', 'sectionDetail', 'projectionReceipt'])
    expect(Object.keys(source)).toEqual([...commonKeys, 'sourceId', 'sourceType', 'title', 'sourceRef', 'contentHash', 'acquisitionStatus', 'acquisitionProfile', 'lineageRef', 'reviewStatus'])
    expect(Object.keys(evidence)).toEqual([...commonKeys, 'evidenceObjectId', 'sourceId', 'sourceType', 'lineageRef', 'extractedFact', 'reviewStatus', 'acceptanceState', 'validationStatus', 'confidence', 'materiality', 'materialityScore', 'title', 'summary', 'contentHash', 'truthHash', 'lineageHash'])
    expect(Object.keys(snapshot)).toEqual([...commonKeys, 'snapshotId', 'graphVersion', 'graphHash', 'stateStatus', 'counts', 'metadata'])
    const elementKeys = [...commonKeys, 'snapshotId', 'graphVersion', 'elementType', 'elementKey', 'fromElementKey', 'toElementKey', 'relationshipType', 'label', 'summary', 'attributes']
    expect(Object.keys(node)).toEqual(elementKeys)
    expect(Object.keys(edge)).toEqual(elementKeys)

    for (const row of [section, source, evidence, snapshot, node, edge]) {
      expect(Object.getPrototypeOf(row)).toBe(Object.prototype)
      expect(row).not.toHaveProperty('_id')
      expect(row).not.toHaveProperty('__v')
      expect(row.save).toBeUndefined()
      expectStringFields(row, [
        'runtimeInstanceId', 'runtimeInstanceKey', 'customerId', 'tenantId',
        'stateVersion', 'sourceStateVersion', 'sourceHash', 'migrationReceiptId',
        'createdAt', 'updatedAt',
      ])
      expect(typeof row.current).toBe('boolean')
      expect(row.runtimeInstanceKey).toBe('runtime-one')
      expect(row.stateVersion).toBe(stateVersion)
      expect(row.sourceStateVersion).toBe(stateVersion)
      expect(row.current).toBe(false)
    }

    expectStringFields(section, [
      'sectionKey', 'legacyPath', 'stateStatus', 'truthStatus', 'truthHash',
      'contentHash', 'summary',
    ])
    expect(Array.isArray(section.evidenceRefs)).toBe(true)
    for (const evidenceRef of section.evidenceRefs) expect(typeof evidenceRef).toBe('string')
    expect(Object.keys(section.sectionDetail)).toEqual([
      'input', 'generated', 'accepted', 'review', 'state', 'lineage',
      'revisions', 'dependencies', 'validation', 'confidence', 'intelligence',
      'metrics', 'additionalEvidence', 'evidenceObjects', 'gsilContext',
    ])
    expect(section.sectionDetail).toMatchObject({
      input: null,
      accepted: {
        summary: ' Accepted summary ',
        truthStatus: 'certified',
        truthHash: hash('a'),
        contentHash: hash('b'),
        evidenceRefs: [' evidence-1 '],
      },
      lineage: {
        sectionKey: 'accepted',
        runtimePath: 'framework_state.sections.accepted',
      },
    })
    expect(section.sectionDetail).not.toBe(section)
    expect(Object.getPrototypeOf(section.projectionReceipt)).toBe(Object.prototype)
    expectStringFields(section.projectionReceipt, [
      'algorithm', 'logicalPath', 'sourceHash', 'stateVersion', 'mappingVersion',
    ])

    expectStringFields(source, [
      'sourceId', 'sourceType', 'title', 'sourceRef', 'contentHash',
      'acquisitionStatus', 'acquisitionProfile', 'lineageRef', 'reviewStatus',
    ])

    expectStringFields(evidence, [
      'evidenceObjectId', 'sourceId', 'sourceType',
      'extractedFact', 'reviewStatus', 'acceptanceState', 'validationStatus',
      'materiality', 'title', 'summary', 'contentHash',
    ])
    expect(evidence.lineageRef).toBeUndefined()
    expect(evidence.truthHash).toBeUndefined()
    expect(evidence.lineageHash).toBeUndefined()
    expect(typeof evidence.materialityScore).toBe('number')
    expectStringFields(evidence.confidence, ['level'])
    expect(typeof evidence.confidence.score).toBe('number')
    expect(Array.isArray(evidence.confidence.basis)).toBe(true)
    for (const basis of evidence.confidence.basis) expect(typeof basis).toBe('string')
    expect(Object.getPrototypeOf(evidence.confidence)).toBe(Object.prototype)

    expectStringFields(snapshot, ['snapshotId', 'graphVersion', 'graphHash', 'stateStatus'])
    expect(typeof snapshot.counts.nodeCount).toBe('number')
    expect(typeof snapshot.counts.edgeCount).toBe('number')
    expect(Object.getPrototypeOf(snapshot.metadata)).toBe(Object.prototype)

    for (const element of [node, edge]) {
      expectStringFields(element, [
        'snapshotId', 'graphVersion', 'elementType', 'elementKey',
        'fromElementKey', 'toElementKey', 'relationshipType', 'label', 'summary',
      ])
      expect(Object.getPrototypeOf(element.attributes)).toBe(Object.prototype)
    }

    expect(section).toMatchObject({
      sectionKey: 'accepted',
      legacyPath: 'framework_state.sections.accepted',
      stateStatus: 'ACCEPTED',
      truthStatus: 'CERTIFIED',
      summary: 'Accepted summary',
      evidenceRefs: ['evidence-1'],
    })
    expect(section.projectionReceipt).toEqual({
      algorithm: RUNTIME_STATE_V2_CANONICAL_ALGORITHM,
      logicalPath: 'framework_state.sections.accepted',
      sourceHash: section.sourceHash,
      stateVersion,
      mappingVersion: 'ss014-v2-mapping-v1',
    })
    expect(source).toMatchObject({
      sourceId: 'source-1', sourceType: 'WEBSITE', title: 'Primary source',
      sourceRef: 'https://example.test/source', contentHash: hash('c'),
      acquisitionStatus: 'COMPLETE', acquisitionProfile: 'web-v1',
      lineageRef: 'source://lineage', reviewStatus: 'ACCEPTED',
    })
    expect(evidence).toMatchObject({
      evidenceObjectId: 'evidence-1', sourceId: 'source-1', extractedFact: 'Fact',
      confidence: { level: 'HIGH', score: 0.9, basis: ['corroborated'] },
      materiality: 'MATERIAL', materialityScore: 0.8,
    })
    expect(snapshot).toMatchObject({
      graphVersion: 'graph-v1', graphHash: hash('e'), stateStatus: 'STALE',
      counts: { nodeCount: 2, edgeCount: 1 },
      metadata: { artifactType: 'intelligence-graph' },
    })
    expect(snapshot.metadata).not.toHaveProperty('counts')
    expect(node).toMatchObject({
      snapshotId: snapshot.snapshotId, graphVersion: 'graph-v1', elementType: 'NODE',
      elementKey: 'node-1', fromElementKey: '', toElementKey: '', relationshipType: '',
      label: 'Node 1', attributes: { sectionKey: 'accepted', metadata: { rank: 1 } },
    })
    expect(edge).toMatchObject({
      elementType: 'EDGE', elementKey: 'edge-1', fromElementKey: 'node-1',
      toElementKey: 'node-2', relationshipType: 'SUPPORTS', attributes: { basis: ['evidence-1'] },
    })
    expect(section.sourceHash).not.toBe(source.sourceHash)
    expect(source.sourceHash).toBe(evidence.sourceHash)
    expect(snapshot.sourceHash).toBe(node.sourceHash)
    expect(section.sourceHash).toBe(canonical.domains.sections.sourceHash)
    expect(source.sourceHash).toBe(canonical.domains.evidencePack.sourceHash)
    expect(snapshot.sourceHash).toBe(canonical.domains.intelligenceGraph.sourceHash)
  })

  test('applies accepted, generated and legacy section precedence by own property', () => {
    const rows = createRuntimeStateLegacyRowSet(makeInput()).rows.sections
    expect(rows.map(({ sectionKey, stateStatus, summary }) => ({ sectionKey, stateStatus, summary }))).toEqual([
      { sectionKey: 'accepted', stateStatus: 'ACCEPTED', summary: 'Accepted summary' },
      { sectionKey: 'generated', stateStatus: 'GENERATED', summary: 'Generated summary' },
      { sectionKey: 'legacy', stateStatus: 'LEGACY_IMPORTED', summary: '' },
    ])

    const wrongAccepted = makeLegacy({ sections: { bad: { accepted: 'not-record', generated: { summary: 'fallback' } } } })
    expectCode(() => createRuntimeStateLegacyRowSet(makeInput(wrongAccepted)), RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID, 'Section mapping is invalid.')
    const wrongSummary = makeLegacy({ sections: { bad: { accepted: { summary: 42 } } } })
    expectCode(() => createRuntimeStateLegacyRowSet(makeInput(wrongSummary)), RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID, 'Section mapping is invalid.')
  })

  test('preserves renderer-facing logical content keys in normalized section detail', () => {
    const legacy = makeLegacy()
    legacy.sections.accepted.accepted.content = 'accepted content'
    legacy.sections.accepted.accepted.body = 'accepted body'
    legacy.sections.accepted.accepted.text = 'accepted text'
    legacy.sections.accepted.accepted.sectionIntelligence = {
      commercialInterpretation: 'Governed commercial interpretation.',
      restrictedClaims: [{ claim: 'Unverified ROI.' }],
    }

    const section = createRuntimeStateLegacyRowSet(makeInput(legacy)).rows.sections[0]
    expect(section.sectionDetail.accepted).toMatchObject({
      content: 'accepted content',
      body: 'accepted body',
      text: 'accepted text',
      sectionIntelligence: {
        commercialInterpretation: 'Governed commercial interpretation.',
        restrictedClaims: [{ claim: 'Unverified ROI.' }],
      },
    })
  })

  test('uses own-field alias precedence and rejects wrong higher-priority types', () => {
    const legacy = makeLegacy()
    legacy.evidencePack.sourceRegistry[0].title = ''
    legacy.evidencePack.sourceRegistry[0].sourceRef = ''
    legacy.evidencePack.sourceRegistry[0].contentHash = ''
    legacy.evidencePack.sourceRegistry[0].lineageRef = ''
    legacy.evidencePack.evidenceObjects[0].lineageRef = ''
    legacy.evidencePack.evidenceObjects[0].extractedFact = ''
    legacy.sections.accepted.accepted.truthStatus = ''
    legacy.sections.accepted.accepted.status = 'fallback'
    legacy.intelligenceGraph.edges[0].relationshipType = ''
    const result = createRuntimeStateLegacyRowSet(makeInput(legacy))
    expect(result.rows.evidenceSources[0]).toMatchObject({
      title: '', sourceRef: '', contentHash: '', lineageRef: '',
    })
    expect(result.rows.evidenceObjects[0]).toMatchObject({ lineageRef: '', extractedFact: '' })
    expect(result.rows.sections[0].truthStatus).toBe('')
    expect(result.rows.graphElements.at(-1).relationshipType).toBe('')

    for (const mutate of [
      (source) => { source.title = 42 },
      (source) => { source.sourceRef = 42 },
      (source) => { source.contentHash = 42 },
      (source) => { source.lineageRef = {} },
      (source) => { source.sourceType = 42 },
      (source) => { source.acquisitionStatus = 42 },
      (source) => { source.acquisitionProfile = 42 },
      (source) => { source.reviewStatus = 42 },
    ]) {
      const badSource = makeLegacy()
      mutate(badSource.evidencePack.sourceRegistry[0])
      expectCode(() => createRuntimeStateLegacyRowSet(makeInput(badSource)), RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID, 'Source mapping is invalid.')
    }

    for (const mutate of [
      (evidence) => { evidence.extractedFact = 42 },
      (evidence) => { evidence.lineageRef = {} },
      (evidence) => { evidence.sourceType = 42 },
      (evidence) => { evidence.reviewStatus = 42 },
      (evidence) => { evidence.validationStatus = 42 },
      (evidence) => { evidence.acceptanceState = 42 },
      (evidence) => { evidence.title = 42 },
      (evidence) => { evidence.summary = 42 },
      (evidence) => { evidence.contentHash = 42 },
      (evidence) => { evidence.truthHash = 42 },
      (evidence) => { evidence.lineageHash = 42 },
    ]) {
      const badEvidence = makeLegacy()
      mutate(badEvidence.evidencePack.evidenceObjects[0])
      expectCode(() => createRuntimeStateLegacyRowSet(makeInput(badEvidence)), RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID, 'Evidence mapping is invalid.')
    }

    const badEdge = makeLegacy()
    badEdge.intelligenceGraph.edges[0].relationshipType = 42
    expectCode(() => createRuntimeStateLegacyRowSet(makeInput(badEdge)), RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID, 'Edge mapping is invalid.')
  })

  test('maps numeric confidence/materiality and rejects score conflicts', () => {
    const legacy = makeLegacy()
    legacy.evidencePack.evidenceObjects[0].confidence = 0.6
    legacy.evidencePack.evidenceObjects[0].materiality = 0.7
    legacy.evidencePack.evidenceObjects[0].materialityScore = 0.7
    const row = createRuntimeStateLegacyRowSet(makeInput(legacy)).rows.evidenceObjects[0]
    expect(row.confidence).toEqual({ level: 'LEGACY_SCORE_ONLY', score: 0.6, basis: [] })
    expect(row).toMatchObject({ materiality: 'LEGACY_SCORE_ONLY', materialityScore: 0.7 })

    legacy.evidencePack.evidenceObjects[0].materialityScore = 0.8
    expectCode(() => createRuntimeStateLegacyRowSet(makeInput(legacy)), RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID, 'Evidence mapping is invalid.')

    const scoreOnly = makeLegacy()
    delete scoreOnly.evidencePack.evidenceObjects[0].materiality
    scoreOnly.evidencePack.evidenceObjects[0].materialityScore = 1
    expect(createRuntimeStateLegacyRowSet(makeInput(scoreOnly)).rows.evidenceObjects[0]).toMatchObject({
      materiality: 'LEGACY_SCORE_ONLY', materialityScore: 1,
    })

    const stringAndScore = makeLegacy()
    stringAndScore.evidencePack.evidenceObjects[0].materiality = 'high'
    stringAndScore.evidencePack.evidenceObjects[0].materialityScore = 0
    expect(createRuntimeStateLegacyRowSet(makeInput(stringAndScore)).rows.evidenceObjects[0]).toMatchObject({
      materiality: 'HIGH', materialityScore: 0,
    })

    for (const confidence of [
      -0.1,
      1.1,
      { level: 'HIGH' },
      { score: 0.5 },
      { level: 'HIGH', score: 0.5, unknown: true },
      { level: 'HIGH', score: 0.5, basis: 'not-array' },
      { level: 'HIGH', score: 0.5, basis: [42] },
    ]) {
      const invalid = makeLegacy()
      invalid.evidencePack.evidenceObjects[0].confidence = confidence
      expectCode(() => createRuntimeStateLegacyRowSet(makeInput(invalid)), RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID, 'Evidence mapping is invalid.')
    }

    for (const score of [0, 1]) {
      const boundary = makeLegacy()
      boundary.evidencePack.evidenceObjects[0].confidence = { level: 'bounded', score, basis: [] }
      expect(createRuntimeStateLegacyRowSet(makeInput(boundary)).rows.evidenceObjects[0].confidence.score).toBe(score)
    }

    for (const [score, expected] of [[1.01, 0.0101], [72, 0.72], [100, 1]]) {
      const percentage = makeLegacy()
      percentage.evidencePack.evidenceObjects[0].confidence = {
        level: ' high ', score, basis: [' source agreement '],
      }
      expect(createRuntimeStateLegacyRowSet(makeInput(percentage)).rows.evidenceObjects[0].confidence).toEqual({
        level: 'HIGH', score: expected, basis: ['source agreement'],
      })
    }

    for (const score of [-1, 100.1]) {
      const invalidPercentage = makeLegacy()
      invalidPercentage.evidencePack.evidenceObjects[0].confidence = { level: 'HIGH', score, basis: [] }
      expectCode(() => createRuntimeStateLegacyRowSet(makeInput(invalidPercentage)), RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID, 'Evidence mapping is invalid.')
    }

    for (const score of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const nonCanonicalPercentage = makeLegacy()
      nonCanonicalPercentage.evidencePack.evidenceObjects[0].confidence = { level: 'HIGH', score, basis: [] }
      expectCode(
        () => createRuntimeStateLegacyRowSet(makeInput(nonCanonicalPercentage)),
        RUNTIME_STATE_V2_CANONICAL_ERROR_CODES.REDACTION_FAILED,
        'Legacy source failed canonical admission.',
      )
    }

    for (const materiality of [-0.1, 1.1, {}]) {
      const invalid = makeLegacy()
      invalid.evidencePack.evidenceObjects[0].materiality = materiality
      delete invalid.evidencePack.evidenceObjects[0].materialityScore
      expectCode(() => createRuntimeStateLegacyRowSet(makeInput(invalid)), RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID, 'Evidence mapping is invalid.')
    }
  })

  test('enforces optional source/evidence hash presence and normalization boundaries', () => {
    const absent = makeLegacy()
    delete absent.evidencePack.sourceRegistry[0].sourceHash
    delete absent.evidencePack.evidenceObjects[0].contentHash
    const absentRows = createRuntimeStateLegacyRowSet(makeInput(absent)).rows
    expect(absentRows.evidenceSources[0].contentHash).toBeUndefined()
    expect(absentRows.evidenceObjects[0].contentHash).toBeUndefined()

    const empty = makeLegacy()
    empty.evidencePack.sourceRegistry[0].contentHash = ''
    empty.evidencePack.evidenceObjects[0].truthHash = ''
    const emptyRows = createRuntimeStateLegacyRowSet(makeInput(empty)).rows
    expect(emptyRows.evidenceSources[0].contentHash).toBe('')
    expect(emptyRows.evidenceObjects[0].truthHash).toBe('')

    const normalized = makeLegacy()
    normalized.evidencePack.sourceRegistry[0].contentHash = `  ${hash('A')}  `
    normalized.evidencePack.evidenceObjects[0].truthHash = `  ${hash('B')}  `
    const normalizedRows = createRuntimeStateLegacyRowSet(makeInput(normalized)).rows
    expect(normalizedRows.evidenceSources[0].contentHash).toBe(hash('a'))
    expect(normalizedRows.evidenceObjects[0].truthHash).toBe(hash('b'))

    for (const [family, mutate, reason] of [
      ['source', (legacy) => { legacy.evidencePack.sourceRegistry[0].contentHash = 'bad' }, 'Source mapping is invalid.'],
      ['evidence', (legacy) => { legacy.evidencePack.evidenceObjects[0].truthHash = 'bad' }, 'Evidence mapping is invalid.'],
    ]) {
      const invalid = makeLegacy()
      mutate(invalid)
      expectCode(() => createRuntimeStateLegacyRowSet(makeInput(invalid)), RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID, reason)
      expect(family).toBeDefined()
    }
  })

  test('reconciles every graph count form and rejects malformed or mismatched values', () => {
    for (const counts of [
      {},
      { counts: { nodeCount: 2, edgeCount: 1 } },
      { nodeCount: 2 },
      { edgeCount: 1 },
      { counts: { nodeCount: 2, edgeCount: 1 }, nodeCount: 2, edgeCount: 1 },
    ]) {
      const graph = makeLegacy().intelligenceGraph
      delete graph.counts
      delete graph.nodeCount
      delete graph.edgeCount
      Object.assign(graph, counts)
      expect(() => createRuntimeStateLegacyRowSet(makeInput(makeLegacy({ intelligenceGraph: graph })))).not.toThrow()
    }
    for (const counts of [
      { counts: { nodeCount: 2, edgeCount: 1, total: 3 } },
      { counts: { nodeCount: '2', edgeCount: 1 } },
      { nodeCount: 1 },
      { edgeCount: -1 },
      { counts: { nodeCount: 1, edgeCount: 1 } },
      { counts: { nodeCount: 2, edgeCount: 0 } },
      { nodeCount: 3 },
      { edgeCount: 2 },
    ]) {
      const graph = makeLegacy().intelligenceGraph
      delete graph.counts
      delete graph.nodeCount
      delete graph.edgeCount
      Object.assign(graph, counts)
      expectCode(
        () => createRuntimeStateLegacyRowSet(makeInput(makeLegacy({ intelligenceGraph: graph }))),
        RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID,
        'Snapshot mapping is invalid.',
      )
    }

    for (const counts of [
      { nodeCount: Number.MAX_SAFE_INTEGER + 1 },
      { edgeCount: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      const graph = makeLegacy().intelligenceGraph
      delete graph.counts
      delete graph.nodeCount
      delete graph.edgeCount
      Object.assign(graph, counts)
      expectCode(
        () => createRuntimeStateLegacyRowSet(makeInput(makeLegacy({ intelligenceGraph: graph }))),
        RUNTIME_STATE_V2_CANONICAL_ERROR_CODES.REDACTION_FAILED,
        'Legacy source failed canonical admission.',
      )
    }
  })

  test('projects full legacy graph identity scope into the minimal V2 snapshot scope', () => {
    const legacy = makeLegacy()
    Object.assign(legacy.intelligenceGraph, {
      runtimeInstanceId: 'runtime-object-id',
      runtimeInstanceKey: 'runtime-one',
      runtimeId: 'runtime-object-id',
      customerId: 'customer-id',
      tenantId: 'tenant-id',
      projectId: 'project-id',
      outcomeId: 'outcome-id',
    })
    legacy.intelligenceGraph.scope = {
      customerId: 'customer-id',
      tenantId: 'tenant-id',
      projectId: 'project-id',
      outcomeId: 'outcome-id',
      frameworkId: ' framework-1 ',
      runtimeId: ' runtime-object-id ',
    }
    const canonical = createRuntimeStateCanonicalMappingManifest(legacy)
    const snapshot = createRuntimeStateLegacyRowSet(makeInput(legacy)).rows.graphSnapshots[0]
    expect(snapshot.metadata.scope).toEqual({ frameworkId: 'framework-1', runtimeId: 'runtime-object-id' })
    for (const key of ['runtimeInstanceId', 'runtimeInstanceKey', 'runtimeId', 'customerId', 'tenantId', 'projectId', 'outcomeId']) {
      expect(snapshot.metadata).not.toHaveProperty(key)
    }
    expect(snapshot.sourceHash).toBe(canonical.serializerResult.domains.intelligenceGraph.sourceHash)

    for (const scope of [null, { frameworkId: 42 }, { frameworkId: 'framework-1', unknown: true }]) {
      const invalid = makeLegacy()
      invalid.intelligenceGraph.scope = scope
      expectCode(
        () => createRuntimeStateLegacyRowSet(makeInput(invalid)),
        RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID,
        'Snapshot mapping is invalid.',
      )
    }
  })

  test('fails closed on every unconsumed graph field', () => {
    for (const [mutate, reason] of [
      [(graph) => { graph.unknownMetadata = true }, 'Snapshot mapping is invalid.'],
      [(graph) => { graph.nodes[0].unknownNodeField = true }, 'Node mapping is invalid.'],
      [(graph) => { graph.edges[0].unknownEdgeField = true }, 'Edge mapping is invalid.'],
    ]) {
      const legacy = makeLegacy()
      mutate(legacy.intelligenceGraph)
      expectCode(
        () => createRuntimeStateLegacyRowSet(makeInput(legacy)),
        RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID,
        reason,
      )
    }
  })

  test('preserves governed legacy node attributes and maps edgeType canonically', () => {
    const legacy = makeLegacy()
    Object.assign(legacy.intelligenceGraph.nodes[0], {
      consumerType: 'FRAMEWORK_SECTION',
      entityDisplayName: 'Company',
      frameworkKey: 'value-narrative',
      packageKey: 'value-narrative',
      packageVersion: '1.0.0',
      publishVersion: 'publish-1',
      publishedAt: '2026-08-26T00:00:00.000Z',
      publishedBy: 'actor-1',
      required: true,
      runtimePath: 'framework_state.sections.overview',
      signalType: 'COVERAGE',
      snapshotId: 'duplicated-row-snapshot',
      sourceEvidenceNodeIds: ['evidence-node-1'],
      sourceKind: 'WEBSITE',
      sourceType: 'WEBSITE',
      scope: ' global ',
    })
    delete legacy.intelligenceGraph.edges[0].relationshipType
    legacy.intelligenceGraph.edges[0].edgeType = 'supports'
    const rows = createRuntimeStateLegacyRowSet(makeInput(legacy)).rows
    const node = rows.graphElements.find(({ elementType, elementKey }) => elementType === 'NODE' && elementKey === 'node-2')
    const edge = rows.graphElements.find(({ elementType }) => elementType === 'EDGE')
    expect(node.attributes).toMatchObject({
      consumerType: 'FRAMEWORK_SECTION',
      entityDisplayName: 'Company',
      frameworkKey: 'value-narrative',
      packageKey: 'value-narrative',
      packageVersion: '1.0.0',
      publishVersion: 'publish-1',
      publishedAt: '2026-08-26T00:00:00.000Z',
      publishedBy: 'actor-1',
      required: true,
      runtimePath: 'framework_state.sections.overview',
      signalType: 'COVERAGE',
      sourceEvidenceNodeIds: ['evidence-node-1'],
      sourceKind: 'WEBSITE',
      sourceType: 'WEBSITE',
      scope: 'GLOBAL',
    })
    expect(node.attributes).not.toHaveProperty('snapshotId')
    expect(edge.relationshipType).toBe('SUPPORTS')
    expect(edge.attributes).not.toHaveProperty('edgeType')

    for (const scope of ['UNKNOWN', 42]) {
      const invalid = makeLegacy()
      invalid.intelligenceGraph.nodes[0].scope = scope
      expectCode(
        () => createRuntimeStateLegacyRowSet(makeInput(invalid)),
        RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID,
        'Node mapping is invalid.',
      )
    }

    const invalidAlias = makeLegacy()
    invalidAlias.intelligenceGraph.edges[0].edgeType = 42
    invalidAlias.intelligenceGraph.edges[0].relationshipType = 'SUPPORTS'
    expectCode(
      () => createRuntimeStateLegacyRowSet(makeInput(invalidAlias)),
      RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID,
      'Edge mapping is invalid.',
    )
  })

  test('rejects every post-trim identity collision and unresolved normalized reference', () => {
    const sourceCollision = makeLegacy()
    sourceCollision.evidencePack.sourceRegistry.push({ sourceId: ' source-1 ', sourceType: 'FILE' })
    expectCode(() => createRuntimeStateLegacyRowSet(makeInput(sourceCollision)), RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID, 'Source mapping is invalid.')

    const evidenceCollision = makeLegacy()
    evidenceCollision.evidencePack.evidenceObjects.push({ evidenceObjectId: ' evidence-1 ', sourceId: 'source-1' })
    expectCode(() => createRuntimeStateLegacyRowSet(makeInput(evidenceCollision)), RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID, 'Evidence mapping is invalid.')

    const nodeCollision = makeLegacy()
    nodeCollision.intelligenceGraph.nodes.push({ id: ' node-1 ' })
    nodeCollision.intelligenceGraph.counts.nodeCount = 3
    nodeCollision.intelligenceGraph.nodeCount = 3
    expectCode(() => createRuntimeStateLegacyRowSet(makeInput(nodeCollision)), RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID, 'Node mapping is invalid.')

    const crossFamily = makeLegacy()
    crossFamily.intelligenceGraph.edges[0].id = ' node-1 '
    expectCode(() => createRuntimeStateLegacyRowSet(makeInput(crossFamily)), RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID, 'Edge mapping is invalid.')

    const endpoint = makeLegacy()
    endpoint.intelligenceGraph.nodes.find((node) => node.nodeId === 'node-1').nodeId = ' node-1 '
    endpoint.intelligenceGraph.edges[0].from = ' node-1 '
    expect(() => createRuntimeStateLegacyRowSet(makeInput(endpoint))).not.toThrow()
    endpoint.intelligenceGraph.edges[0].from = ' unknown '
    expectCode(() => createRuntimeStateLegacyRowSet(makeInput(endpoint)), RUNTIME_STATE_V2_CANONICAL_ERROR_CODES.MAPPING_REQUIRED, 'Legacy source mapping is incomplete or ambiguous.')
  })

  test('uses canonical stable and fallback graph keys', () => {
    const nodeValue = { label: 'A' }
    const nodeKey = `sha256:${createHash('sha256').update('{"label":"A"}', 'utf8').digest('hex')}`
    const edgeValue = { from: nodeKey, relation: 'SELF', to: nodeKey }
    const edgeKey = `sha256:${createHash('sha256').update(JSON.stringify(edgeValue), 'utf8').digest('hex')}`
    const legacy = makeLegacy({
      intelligenceGraph: { graphVersion: 'g-derived', nodes: [nodeValue], edges: [edgeValue] },
    })
    const elements = createRuntimeStateLegacyRowSet(makeInput(legacy)).rows.graphElements
    expect(elements.map(({ elementKey }) => elementKey)).toEqual([nodeKey, edgeKey])
  })

  test('redacts every serializer-originated failure reason', () => {
    const cases = []
    const duplicateSource = makeLegacy()
    duplicateSource.evidencePack.sourceRegistry.push({ sourceId: 'source-1' })
    cases.push([duplicateSource, RUNTIME_STATE_V2_CANONICAL_ERROR_CODES.MAPPING_REQUIRED, 'Legacy source mapping is incomplete or ambiguous.'])
    const unknownSource = makeLegacy()
    unknownSource.evidencePack.evidenceObjects[0].sourceId = 'secret-source'
    cases.push([unknownSource, RUNTIME_STATE_V2_CANONICAL_ERROR_CODES.MAPPING_REQUIRED, 'Legacy source mapping is incomplete or ambiguous.'])
    const duplicateGraph = makeLegacy()
    duplicateGraph.intelligenceGraph.nodes.push({ id: 'node-1' })
    cases.push([duplicateGraph, RUNTIME_STATE_V2_CANONICAL_ERROR_CODES.MAPPING_REQUIRED, 'Legacy source mapping is incomplete or ambiguous.'])
    const invalidScalar = makeLegacy()
    invalidScalar.sections.bad = { value: Number.NaN }
    cases.push([invalidScalar, RUNTIME_STATE_V2_CANONICAL_ERROR_CODES.REDACTION_FAILED, 'Legacy source failed canonical admission.'])
    const capExceeded = makeLegacy()
    capExceeded.rawBsonBytes = (12 * 1024 * 1024) + 1
    cases.push([capExceeded, RUNTIME_STATE_V2_CANONICAL_ERROR_CODES.CAP_EXCEEDED, 'Legacy source exceeded canonical caps.'])

    for (const [legacy, code, reason] of cases) {
      const error = expectCode(() => createRuntimeStateLegacyRowSet(makeInput(legacy)), code, reason)
      expect(error.details.reason.length).toBeLessThanOrEqual(120)
      expect(error.details.reason).not.toMatch(/source-1|secret-source|node-1|NaN|canonicalJson/)
    }
  })

  test.each([
    ['section', (legacy) => { legacy.sections.accepted.accepted.summary = 'x'.repeat(4001) }, 'summary'],
    ['source', (legacy) => { legacy.evidencePack.sourceRegistry[0].title = 'x'.repeat(1001) }, 'title'],
    ['evidence', (legacy) => { legacy.evidencePack.evidenceObjects[0].title = 'x'.repeat(1001) }, 'title'],
    ['snapshot', (legacy) => { legacy.intelligenceGraph.graphVersion = 'x'.repeat(201) }, 'graphVersion'],
    ['node', (legacy) => { legacy.intelligenceGraph.nodes[0].label = 'x'.repeat(1001) }, 'label'],
    ['edge', (legacy) => { legacy.intelligenceGraph.edges[0].label = 'x'.repeat(1001) }, 'label'],
  ])('sanitizes %s schema failures to family and path', (family, mutate, path) => {
    const legacy = makeLegacy()
    mutate(legacy)
    expectCode(
      () => createRuntimeStateLegacyRowSet(makeInput(legacy)),
      RUNTIME_STATE_V2_MAPPING_ERROR_CODES.SCHEMA_INVALID,
      `V2 ${family} row failed schema validation at ${path}.`,
    )
  })

  test('rejects exact input envelope, authority and timestamp drift', () => {
    expectCode(() => createRuntimeStateLegacyRowSet({ ...makeInput(), extra: true }), RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID, 'Mapper envelope is invalid.')
    expectCode(() => createRuntimeStateLegacyRowSet(makeInput(makeLegacy(), { stateVersion: 'revision-1' })), RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID, 'Mapper state version is invalid.')
    expectCode(() => createRuntimeStateLegacyRowSet(makeInput(makeLegacy(), { migrationReceiptId: 'bad' })), RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID, 'Mapper receipt identity is invalid.')
    expectCode(() => createRuntimeStateLegacyRowSet(makeInput(makeLegacy(), { migrationTimestamp: '2026-08-26' })), RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID, 'Mapper timestamp is invalid.')

    const revoked = Proxy.revocable(makeInput().scope, {})
    revoked.revoke()
    expectCode(
      () => createRuntimeStateLegacyRowSet(makeInput(makeLegacy(), { scope: revoked.proxy })),
      RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID,
      'Mapper envelope is invalid.',
    )

    const badGraphHash = makeLegacy()
    badGraphHash.intelligenceGraph.graphHash = 'not-a-hash'
    expectCode(
      () => createRuntimeStateLegacyRowSet(makeInput(badGraphHash)),
      RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID,
      'Snapshot mapping is invalid.',
    )

    const absentGraphHash = makeLegacy()
    delete absentGraphHash.intelligenceGraph.graphHash
    expect(createRuntimeStateLegacyRowSet(makeInput(absentGraphHash)).rows.graphSnapshots[0].graphHash).toBe('')

    const emptyGraphHash = makeLegacy()
    emptyGraphHash.intelligenceGraph.graphHash = ''
    expectCode(
      () => createRuntimeStateLegacyRowSet(makeInput(emptyGraphHash)),
      RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID,
      'Snapshot mapping is invalid.',
    )

    const normalizedGraphHash = makeLegacy()
    normalizedGraphHash.intelligenceGraph.graphHash = `  ${hash('F')}  `
    expect(createRuntimeStateLegacyRowSet(makeInput(normalizedGraphHash)).rows.graphSnapshots[0].graphHash).toBe(hash('f'))

    const objectIdInput = makeInput()
    objectIdInput.scope.runtimeInstanceId = new mongoose.Types.ObjectId(objectIdInput.scope.runtimeInstanceId)
    objectIdInput.scope.customerId = new mongoose.Types.ObjectId(objectIdInput.scope.customerId)
    objectIdInput.scope.tenantId = new mongoose.Types.ObjectId(objectIdInput.scope.tenantId)
    objectIdInput.migrationReceiptId = new mongoose.Types.ObjectId(objectIdInput.migrationReceiptId)
    const objectIdRow = createRuntimeStateLegacyRowSet(objectIdInput).rows.sections[0]
    expect(objectIdRow.runtimeInstanceId).toBe('64b7f7a4e1e5f8320c000001')
    expect(objectIdRow.migrationReceiptId).toBe('64b7f7a4e1e5f8320c000004')
  })

  test('is deterministic under permutation and detached from input and prior results', () => {
    const legacy = makeLegacy()
    const first = createRuntimeStateLegacyRowSet(makeInput(legacy))
    const permuted = makeLegacy({
      sections: Object.fromEntries(Object.entries(legacy.sections).reverse()),
      evidencePack: {
        sourceRegistry: [...legacy.evidencePack.sourceRegistry].reverse(),
        evidenceObjects: [...legacy.evidencePack.evidenceObjects].reverse(),
      },
      intelligenceGraph: {
        ...legacy.intelligenceGraph,
        nodes: [...legacy.intelligenceGraph.nodes].reverse(),
      },
    })
    expect(createRuntimeStateLegacyRowSet(makeInput(permuted))).toEqual(first)

    first.rows.sections[0].summary = 'mutated-result'
    legacy.sections.accepted.accepted.summary = 'mutated-input'
    expect(createRuntimeStateLegacyRowSet(makeInput(makeLegacy())).rows.sections[0].summary).toBe('Accepted summary')
  })
})

// Explicitly authored metadata witness, not a capture or native authorization receipt.
const metadataDescriptor = (native = { customerId: '1'.repeat(24), tenantId: '2'.repeat(24), runtimeInstanceId: '3'.repeat(24), runtimeInstanceKey: 'runtime-one' }) => {
  const fixture = { fixtureId: 'ss049-ac8-long-page-r1', fixtureVersion: 1,
    fixtureFileSha256: '7b7fe9a7819a71a25a043a73d7de1f9ed5b2689c36332ca981e65d7422771fd9',
    htmlSha256: '7f89c175b0da167969061551865ee67ad42b793283e61aecaec9f84aadc35777', sourceUrl: 'https://controlled-context.example/case-study' }
  const binding = { contractVersion: 'controlled-replay-binding.v1', bindingId: 'synthetic-metadata-only', bindingVersion: 1,
    classification: 'CONTROLLED_SYNTHETIC_REPLAY', environment: 'DEVELOPMENT_TEST',
    scope: Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId'].map(key => [key, String(native[key])])),
    revisionId: native.runtimeInstanceKey, basisStateVersion: 'rsv2:11111111-1111-4111-8111-111111111111',
    actorUserId: '4'.repeat(24), authorityRef: 'synthetic:authority', isolationRef: 'synthetic:isolation', fixture }
  return { binding, provenance: { contractVersion: 'controlled-replay-provenance.v1', classification: 'CONTROLLED_SYNTHETIC_REPLAY',
    operation: 'CONTROLLED_HTML_REPLAY_CAPTURE', adapter: 'controlled-html-replay-v1', bindingId: binding.bindingId,
    bindingVersion: 1, bindingDigest: storedControlledReplayBindingDigest(binding), ...fixture } }
}

describe('stored controlled descriptor through maintained native transport', () => {
  const metadataProduct = () => {
    const scope = { ...makeInput().scope, runtimeInstanceKey: 'runtime-one' }, descriptor = metadataDescriptor(scope)
    const source = { sourceId: 'metadata-source', sourceType: 'WEBSITE', label: 'Synthetic source assertion',
      url: descriptor.binding.fixture.sourceUrl, acquisitionStatus: 'NOT_ATTEMPTED', controlledReplayProvenance: descriptor }
    const evidence = { evidenceObjectId: 'metadata-evidence', sourceId: source.sourceId,
      extractedFact: 'The synthetic trial has not started and has no measured benefit.', reviewStatus: 'PENDING',
      acquisitionMethod: 'CUSTOMER_PROVIDED_INPUT', controlledReplayProvenance: descriptor }
    const objects = normalizeDiscoveryEvidenceObjects({ sources: [source], sourceRegistry: [source], evidenceObjects: [evidence] })
    const sourceRegistry = buildDiscoverySourceRegistry({ sourceRegistry: [source], evidenceObjects: objects })
    return { scope, descriptor, sourceRegistry, evidenceObjects: objects }
  }
  test('normalizer, registry, mapper, models and qualification retain exact descriptor without receipt or authenticity', () => {
    const product = metadataProduct(), input = makeInput(makeLegacy({ evidencePack: product }))
    const mapped = createRuntimeStateLegacySourceRowSet(input), source = mapped.rows.evidenceSources[0], evidence = mapped.rows.evidenceObjects[0]
    expect(source.controlledReplayProvenance).toEqual(product.descriptor)
    expect(evidence.controlledReplayProvenance).toEqual(product.descriptor)
    expect(source.stateVersion).not.toBe(product.descriptor.binding.basisStateVersion)
    expect(new RuntimeEvidenceSource(source).validateSync()).toBeUndefined()
    expect(new RuntimeEvidenceObject(evidence).validateSync()).toBeUndefined()
    expect(source.sourceCapture).toBeUndefined(); expect(evidence.evidenceSupport).toBeUndefined()
    const qualified = buildRuntimeSectionEvidenceQualifications({ sourceRegistry: [source], lineageSources: [source],
      evidenceObjects: [evidence], admittedEvidenceIds: [evidence.evidenceObjectId] })
    expect(qualified.sources[0]).toMatchObject({ controlledReplayProvenance: product.descriptor,
      sourceReview: { status: 'NOT_RECORDED', authenticity: null } })
    expect(qualified.evidence[0]).toMatchObject({ controlledReplayProvenance: product.descriptor, reviewStatus: 'PENDING' })
    const { controlledReplayProvenance: ignored, ...absent } = evidence
    expect(ignored).toEqual(product.descriptor)
    expect(evidenceMaterialHash(absent)).not.toBe(evidenceMaterialHash(evidence))
  })
  test('raw typed metadata, pair/drop and actual native revision mismatches fail before casting or inheritance', () => {
    const product = metadataProduct(), mapped = createRuntimeStateLegacySourceRowSet(makeInput(makeLegacy({ evidencePack: product })))
    for (const Model of [RuntimeEvidenceSource, RuntimeEvidenceObject]) {
      const row = Model === RuntimeEvidenceSource ? mapped.rows.evidenceSources[0] : mapped.rows.evidenceObjects[0]
      for (const change of [d => { d.binding.bindingVersion = '1' }, d => { d.provenance.enabled = true },
        d => { d.binding.scope.tenantId = 'f'.repeat(24) }]) {
        const descriptor = JSON.parse(JSON.stringify(product.descriptor)); change(descriptor)
        expect(new Model({ ...row, controlledReplayProvenance: descriptor }).validateSync()).toBeDefined()
      }
      expect(new Model({ ...row, runtimeInstanceKey: 'other' }).validateSync()).toBeDefined()
      const getter = () => { throw new Error('getter must not run') }
      const unsafe = Object.defineProperty({}, 'binding', { get: getter, enumerable: true })
      expect(new Model({ ...row, controlledReplayProvenance: unsafe }).validateSync()).toBeDefined()
    }
    delete product.evidenceObjects[0].controlledReplayProvenance
    expect(() => createRuntimeStateLegacySourceRowSet(makeInput(makeLegacy({ evidencePack: product })))).toThrow()
  })
})

describe('registered source type and selected section reference materialization', () => {
  test.each([undefined, '', '  ', ' website '])('projects registered type for absent, blank or matching object type %p', type => {
    const input = makeInput()
    if (type === undefined) delete input.legacyInput.evidencePack.evidenceObjects[0].sourceType
    else input.legacyInput.evidencePack.evidenceObjects[0].sourceType = type
    const before = JSON.stringify(input)
    const result = createRuntimeStateLegacySourceRowSet(input)
    expect(result.rows.evidenceObjects[0].sourceType).toBe('WEBSITE')
    expect(JSON.stringify(input)).toBe(before)
    expect(result.sourceSetHash).toBe(createRuntimeStateCanonicalMappingManifest(input.legacyInput).serializerResult.sourceSetHash)
  })

  test.each(['UPLOADED_DOCUMENT', 42, null, {}, []].map(type => ({ type })))('rejects conflicting or malformed object type $type', ({ type }) => {
    const input = makeInput()
    input.legacyInput.evidencePack.evidenceObjects[0].sourceType = type
    expect(() => createRuntimeStateLegacySourceRowSet(input)).toThrow()
  })

  test('rejects absent and ambiguous source registry instead of guessing a type', () => {
    for (const mode of ['absent', 'duplicate']) {
      const input = makeInput()
      delete input.legacyInput.evidencePack.evidenceObjects[0].sourceType
      if (mode === 'absent') input.legacyInput.evidencePack.sourceRegistry = []
      else input.legacyInput.evidencePack.sourceRegistry.push({ ...input.legacyInput.evidencePack.sourceRegistry[0] })
      expect(() => createRuntimeStateLegacySourceRowSet(input)).toThrow()
    }
  })

  test('uses selected accepted support references, preserving context tokens and generated history', () => {
    const input = makeInput(), section = input.legacyInput.sections.accepted
    delete section.accepted.evidenceRefs
    section.accepted.supportingEvidenceRefs = [' evidence-1 ', 'section_input', 'scoped_view', 'source-1']
    section.generated.supportingEvidenceRefs = ['not-selected']
    const before = JSON.stringify(input)
    const result = createRuntimeStateLegacySourceRowSet(input)
    const row = result.rows.sections.find(s => s.sectionKey === 'accepted')
    expect(row.evidenceRefs).toEqual(['evidence-1', 'section_input', 'scoped_view', 'source-1'])
    expect(row.sectionDetail.generated.supportingEvidenceRefs).toEqual(['not-selected'])
    expect(result.rows.sections.find(s => s.sectionKey === 'legacy').evidenceRefs).toEqual([])
    expect(JSON.stringify(input)).toBe(before)
  })

  test('projects generated support only when no accepted payload exists', () => {
    const input = makeInput()
    input.legacyInput.sections.generated.generated.supportingEvidenceRefs = ['evidence-1']
    expect(createRuntimeStateLegacySourceRowSet(input).rows.sections.find(s => s.sectionKey === 'generated').evidenceRefs).toEqual(['evidence-1'])
  })

  test('accepts normalized equal explicit and support references without altering source hashes', () => {
    const input = makeInput()
    input.legacyInput.sections.accepted.accepted.supportingEvidenceRefs = ['evidence-1']
    const result = createRuntimeStateLegacySourceRowSet(input)
    expect(result.rows.sections.find(s => s.sectionKey === 'accepted').evidenceRefs).toEqual(['evidence-1'])
    expect(result.sourceSetHash).toBe(createRuntimeStateCanonicalMappingManifest(input.legacyInput).serializerResult.sourceSetHash)
  })

  test.each([[], ['other'], ['evidence-1', 'source-1']].map(refs => ({ refs })))('rejects conflicting selected support references $refs', ({ refs }) => {
    const input = makeInput()
    input.legacyInput.sections.accepted.accepted.supportingEvidenceRefs = refs
    expect(() => createRuntimeStateLegacySourceRowSet(input)).toThrow()
  })

  test.each([null, 'evidence-1', [42], [''], ['  '], Array(1), Array(10001).fill('evidence-1')].map(refs => ({ refs })))('rejects malformed selected support references case %#', ({ refs }) => {
    const input = makeInput()
    delete input.legacyInput.sections.accepted.accepted.evidenceRefs
    input.legacyInput.sections.accepted.accepted.supportingEvidenceRefs = refs
    expect(() => createRuntimeStateLegacySourceRowSet(input)).toThrow()
  })
})
