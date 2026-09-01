import { createHash } from 'node:crypto'

import { describe, expect, test } from '@jest/globals'
import mongoose from 'mongoose'

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

    const section = createRuntimeStateLegacyRowSet(makeInput(legacy)).rows.sections[0]
    expect(section.sectionDetail.accepted).toMatchObject({
      content: 'accepted content',
      body: 'accepted body',
      text: 'accepted text',
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
