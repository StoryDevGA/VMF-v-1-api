import { describe, expect, test } from '@jest/globals'
import mongoose from 'mongoose'

import models from '../models/index.js'
import RuntimeStateSection, { runtimeStateSectionSchema } from '../models/RuntimeStateSection.js'
import RuntimeEvidenceSource, { runtimeEvidenceSourceSchema } from '../models/RuntimeEvidenceSource.js'
import RuntimeEvidenceObject, { runtimeEvidenceObjectSchema } from '../models/RuntimeEvidenceObject.js'
import RuntimeGraphSnapshot, { runtimeGraphSnapshotSchema } from '../models/RuntimeGraphSnapshot.js'
import RuntimeGraphElement, { runtimeGraphElementSchema } from '../models/RuntimeGraphElement.js'
import { SS014_LEGACY_CANONICAL_ALGORITHM } from '../services/ss014LegacyDomainCanonicalSerializer.js'

const stateVersion = 'rsv2:123e4567-e89b-42d3-a456-426614174000'
const sourceHash = `sha256:${'a'.repeat(64)}`
const contentHash = `sha256:${'b'.repeat(64)}`
const objectId = '64b7f7a4e1e5f8320c000001'

const commonFields = () => ({
  runtimeInstanceId: objectId,
  runtimeInstanceKey: 'runtime-one',
  customerId: objectId,
  tenantId: objectId,
  stateVersion,
  sourceStateVersion: stateVersion,
  sourceHash,
  migrationReceiptId: objectId,
})

const validDocuments = () => ({
  section: new RuntimeStateSection({
    ...commonFields(),
    sectionKey: 'overview',
    legacyPath: 'framework_state.sections.overview',
    stateStatus: 'ready',
    evidenceRefs: ['evidence-1'],
    projectionReceipt: {
      algorithm: SS014_LEGACY_CANONICAL_ALGORITHM,
      logicalPath: 'framework_state.sections.overview',
      sourceHash,
      stateVersion,
      mappingVersion: 'ss014-v2-mapping-v1',
    },
  }),
  evidenceSource: new RuntimeEvidenceSource({
    ...commonFields(),
    sourceId: 'source-1',
    sourceType: 'document',
    contentHash,
    acquisitionStatus: 'complete',
    acquisitionProfile: 'document-v1',
    lineageRef: 'source://one',
  }),
  evidenceObject: new RuntimeEvidenceObject({
    ...commonFields(),
    evidenceObjectId: 'evidence-1',
    sourceId: 'source-1',
    validationStatus: 'validated',
    confidence: { level: 'high', score: 0.9, basis: ['corroborated'] },
    materiality: 'material',
    materialityScore: 0.8,
    contentHash,
  }),
  graphSnapshot: new RuntimeGraphSnapshot({
    ...commonFields(),
    snapshotId: 'snapshot-1',
    graphVersion: 'graph-v1',
    stateStatus: 'current',
    counts: { nodeCount: 1, edgeCount: 0 },
    metadata: {
      artifactType: 'intelligence-graph',
      scope: { frameworkId: 'framework-1', runtimeId: 'runtime-one' },
      registries: { entities: { version: 1 } },
    },
  }),
  graphNode: new RuntimeGraphElement({
    ...commonFields(),
    snapshotId: 'snapshot-1',
    graphVersion: 'graph-v1',
    elementType: 'node',
    elementKey: 'node-1',
    attributes: {
      nodeType: 'COMPANY',
      scope: { frameworkId: 'framework-1', runtimeId: 'runtime-one' },
      metadata: { classification: 'customer' },
    },
  }),
  graphEdge: new RuntimeGraphElement({
    ...commonFields(),
    snapshotId: 'snapshot-1',
    graphVersion: 'graph-v1',
    elementType: 'edge',
    elementKey: 'edge-1',
    fromElementKey: 'node-1',
    toElementKey: 'node-2',
    attributes: { relationshipDefinitionKey: 'supplies', sourceRefs: ['source-1'] },
  }),
})

const expectInvalid = (document, path) => {
  const error = document.validateSync()
  expect(error).toBeDefined()
  if (path) expect(error.errors[path]).toBeDefined()
}

const expectConstructionOrValidationFailure = (construct) => {
  let document
  try {
    document = construct()
  } catch (error) {
    expect(error).toBeDefined()
    return
  }
  expect(document.validateSync()).toBeDefined()
}

const modelsBySchema = [
  { label: 'section', model: RuntimeStateSection, schema: runtimeStateSectionSchema, collection: 'runtime_section_states', keyField: 'sectionKey' },
  { label: 'evidence source', model: RuntimeEvidenceSource, schema: runtimeEvidenceSourceSchema, collection: 'runtime_evidence_sources', keyField: 'sourceId' },
  { label: 'evidence object', model: RuntimeEvidenceObject, schema: runtimeEvidenceObjectSchema, collection: 'runtime_evidence_objects', keyField: 'evidenceObjectId' },
  { label: 'graph snapshot', model: RuntimeGraphSnapshot, schema: runtimeGraphSnapshotSchema, collection: 'runtime_graph_snapshots', keyField: 'graphVersion' },
  { label: 'graph element', model: RuntimeGraphElement, schema: runtimeGraphElementSchema, collection: 'runtime_graph_elements', keyField: 'elementKey' },
]

const indexNames = (schema) => schema.indexes().map(([, options]) => options.name)

describe('Runtime State Storage V2 physical foundations', () => {
  test('registers the adopted five collection models without live database calls', () => {
    expect(models.RuntimeStateSection).toBe(RuntimeStateSection)
    expect(models.RuntimeEvidenceSource).toBe(RuntimeEvidenceSource)
    expect(models.RuntimeEvidenceObject).toBe(RuntimeEvidenceObject)
    expect(models.RuntimeGraphSnapshot).toBe(RuntimeGraphSnapshot)
    expect(models.RuntimeGraphElement).toBe(RuntimeGraphElement)
    expect(modelsBySchema.map(({ model }) => model.collection.name)).toEqual([
      'runtime_section_states',
      'runtime_evidence_sources',
      'runtime_evidence_objects',
      'runtime_graph_snapshots',
      'runtime_graph_elements',
    ])
  })

  test.each(modelsBySchema)('$label exposes scoped version/currentness foundations', ({ schema, keyField }) => {
    expect(schema.options.strict).toBe('throw')
    expect(schema.path('runtimeInstanceId').options.required).toBe(true)
    expect(schema.path('customerId').options.required).toBe(true)
    expect(schema.path('tenantId').options.required).toBe(true)
    expect(schema.path('stateVersion').options.required).toBe(true)
    expect(schema.path('sourceStateVersion').options.required).toBe(true)
    expect(schema.path('migrationReceiptId').options.required).toBe(true)
    expect(schema.path('current').options.default).toBe(false)
    expect(schema.path('isCurrent')).toBeUndefined()
    expect(indexNames(schema)).toEqual([
      `unique_runtime_${keyField === 'graphVersion' ? 'graph_snapshot' : keyField === 'elementKey' ? 'graph_element' : keyField === 'sectionKey' ? 'state_section' : keyField === 'sourceId' ? 'evidence_source' : 'evidence_object'}_version`,
      `unique_current_runtime_${keyField === 'graphVersion' ? 'graph_snapshot' : keyField === 'elementKey' ? 'graph_element' : keyField === 'sectionKey' ? 'state_section' : keyField === 'sourceId' ? 'evidence_source' : 'evidence_object'}`,
    ])
  })

  test('keeps Option A authority separate from the compatibility alias', () => {
    expect(models.RuntimeInstance.schema.path('stateVersion').options.default).toBeUndefined()
    expect(models.RuntimeInstance.schema.path('runtimeStateVersion').options.immutable).toBe(true)
    expect(models.RuntimeInstance.schema.path('revision.revisionNumber')).toBeDefined()
  })

  test('declares graph element identity for both node and edge records', () => {
    expect(runtimeGraphElementSchema.path('elementType').enumValues).toEqual(['NODE', 'EDGE'])
    expect(runtimeGraphElementSchema.path('elementKey').options.required).toBe(true)
    expect(runtimeGraphElementSchema.path('fromElementKey')).toBeDefined()
    expect(runtimeGraphElementSchema.path('toElementKey')).toBeDefined()
  })

  test('validates representative rows for all five collection families', () => {
    const documents = validDocuments()
    Object.values(documents).forEach((document) => expect(document.validateSync()).toBeUndefined())
    expect(documents.evidenceSource.acquisitionStatus).toBe('COMPLETE')
    expect(documents.evidenceObject.confidence.level).toBe('HIGH')
    expect(documents.graphNode.elementType).toBe('NODE')
  })

  test.each([
    ['missing sourceHash', { sourceHash: undefined }, 'sourceHash'],
    ['malformed sourceHash', { sourceHash: 'sha256:not-a-hash' }, 'sourceHash'],
    ['malformed stateVersion', { stateVersion: 'revision-42' }, 'stateVersion'],
    ['uppercase stateVersion is normalized then accepted', { stateVersion: stateVersion.toUpperCase(), sourceStateVersion: stateVersion }, null],
    ['different sourceStateVersion', { sourceStateVersion: 'rsv2:123e4567-e89b-42d3-a456-426614174001' }, 'sourceStateVersion'],
  ])('%s', (_label, replacements, invalidPath) => {
    const document = validDocuments().evidenceSource
    Object.assign(document, replacements)
    if (invalidPath) expectInvalid(document, invalidPath)
    else expect(document.validateSync()).toBeUndefined()
  })

  test('enforces section logical-path, projection receipt and reference boundaries', () => {
    const section = validDocuments().section
    section.legacyPath = 'framework_state.sections.other'
    expectInvalid(section, 'legacyPath')

    const receiptMismatch = validDocuments().section
    receiptMismatch.projectionReceipt.sourceHash = contentHash
    expectInvalid(receiptMismatch, 'projectionReceipt')

    const unknownReceiptField = new RuntimeStateSection({
      ...validDocuments().section.toObject(),
      projectionReceipt: {
        ...validDocuments().section.projectionReceipt.toObject(),
        unexpected: true,
      },
    })
    expectInvalid(unknownReceiptField, 'projectionReceipt')

    const tooManyRefs = validDocuments().section
    tooManyRefs.evidenceRefs = Array.from({ length: 10001 }, (_, index) => `e-${index}`)
    expectInvalid(tooManyRefs, 'evidenceRefs')

    expectConstructionOrValidationFailure(() => new RuntimeStateSection({
      ...validDocuments().section.toObject(),
      framework_state: { raw: true },
    }))
  })

  test('enforces evidence normalization, confidence, materiality and hash bounds', () => {
    const evidence = validDocuments().evidenceObject
    evidence.confidence.score = 1.01
    expectInvalid(evidence, 'confidence.score')

    const tooMuchBasis = validDocuments().evidenceObject
    tooMuchBasis.confidence.basis = Array.from({ length: 101 }, () => 'basis')
    expectInvalid(tooMuchBasis, 'confidence.basis')

    expectConstructionOrValidationFailure(() => new RuntimeEvidenceObject({
      ...validDocuments().evidenceObject.toObject(),
      confidence: { level: 'HIGH', score: 0.9, basis: [], unknown: true },
    }))

    const materiality = validDocuments().evidenceObject
    materiality.materialityScore = -0.01
    expectInvalid(materiality, 'materialityScore')

    const badHash = validDocuments().evidenceObject
    badHash.truthHash = 'sha256:ABC'
    expectInvalid(badHash, 'truthHash')

    const optional = new RuntimeEvidenceSource({
      ...commonFields(),
      sourceId: 'source-optional',
      sourceType: 'website',
    })
    expect(optional.validateSync()).toBeUndefined()
    expect(optional.contentHash).toBeUndefined()
    expect(optional.reviewStatus).toBeUndefined()
  })

  test('enforces strict graph counts and snapshot metadata root ownership', () => {
    const negative = validDocuments().graphSnapshot
    negative.counts.nodeCount = -1
    expectInvalid(negative, 'counts.nodeCount')

    const unsafe = validDocuments().graphSnapshot
    unsafe.counts.edgeCount = Number.MAX_SAFE_INTEGER + 1
    expectInvalid(unsafe, 'counts.edgeCount')

    const unknownCountField = new RuntimeGraphSnapshot({
      ...validDocuments().graphSnapshot.toObject(),
      counts: { nodeCount: 1, edgeCount: 0, totalCount: 1 },
    })
    expectInvalid(unknownCountField, 'counts')

    for (const metadata of [
      { nodes: [] },
      { build: { rawText: 'payload' } },
      { coverage: { runtimeInstanceId: 'duplicate' } },
      { scope: { frameworkId: 'framework-1', customerId: 'duplicate' } },
      { unknownRoot: true },
    ]) {
      const snapshot = validDocuments().graphSnapshot
      snapshot.metadata = metadata
      expectInvalid(snapshot, 'metadata')
    }
  })

  test('rejects unsafe JSON structures and scalar limits', () => {
    const cyclic = {}
    cyclic.loop = cyclic
    const accessor = {}
    Object.defineProperty(accessor, 'value', { enumerable: true, get: () => 1 })
    const sparse = []
    sparse[1] = 'gap'
    const customArray = []
    customArray.extra = true
    const symbolRecord = { value: 1 }
    symbolRecord[Symbol('hidden')] = true
    const customPrototype = Object.create({ inherited: true })
    customPrototype.value = 1
    const hiddenRecord = { value: 1 }
    Object.defineProperty(hiddenRecord, 'hidden', { value: true })
    const hiddenArray = []
    Object.defineProperty(hiddenArray, 'hidden', { value: true })
    const proxy = new Proxy({ value: 1 }, {})

    for (const metadataValue of [
      cyclic,
      accessor,
      sparse,
      customArray,
      symbolRecord,
      customPrototype,
      hiddenRecord,
      hiddenArray,
      proxy,
      new Date(),
      new mongoose.Types.ObjectId(),
    ]) {
      const snapshot = validDocuments().graphSnapshot
      snapshot.metadata = { build: metadataValue }
      expectInvalid(snapshot, 'metadata')
    }

    for (const safeValue of [1.5, -0.25, -0]) {
      const snapshot = validDocuments().graphSnapshot
      snapshot.metadata = { build: { safeValue } }
      expect(snapshot.validateSync()).toBeUndefined()
    }

    for (const unsafeValue of [undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      const snapshot = validDocuments().graphSnapshot
      snapshot.metadata = { build: { unsafeValue } }
      expectInvalid(snapshot, 'metadata')
    }

    const deep = { leaf: true }
    for (let depth = 0; depth < 9; depth += 1) deep.leaf = { previous: deep.leaf }
    const deepSnapshot = validDocuments().graphSnapshot
    deepSnapshot.metadata = { build: deep }
    expectInvalid(deepSnapshot, 'metadata')

    const oversizedString = validDocuments().graphSnapshot
    oversizedString.metadata = { warnings: ['x'.repeat(8001)] }
    expectInvalid(oversizedString, 'metadata')

    const oversizedBytes = validDocuments().graphNode
    oversizedBytes.attributes = { snippet: 'x'.repeat(32768) }
    expectInvalid(oversizedBytes, 'attributes')

    const oversizedEntries = validDocuments().graphEdge
    oversizedEntries.attributes = { sourceRefs: Array.from({ length: 1000 }, () => 'source') }
    expectInvalid(oversizedEntries, 'attributes')

    const originalMetadata = { build: { sequence: [1, 2, 3] } }
    const isolated = validDocuments().graphSnapshot
    isolated.metadata = originalMetadata
    expect(isolated.validateSync()).toBeUndefined()
    expect(originalMetadata).toEqual({ build: { sequence: [1, 2, 3] } })
  })

  test('requires valid Unicode scalar strings for safe-JSON keys and values', () => {
    const unpairedHigh = '\ud800'
    const unpairedLow = '\udc00'

    for (const malformed of [unpairedHigh, unpairedLow]) {
      const valueFailure = validDocuments().graphNode
      valueFailure.attributes = { snippet: malformed }
      expectInvalid(valueFailure, 'attributes')

      const keyFailure = validDocuments().graphNode
      keyFailure.attributes = { metadata: { [malformed]: 'value' } }
      expectInvalid(keyFailure, 'attributes')
    }

    const validPair = '\ud83d\ude00'
    const validKeyAndValue = validDocuments().graphNode
    validKeyAndValue.attributes = { metadata: { [validPair]: validPair } }
    expect(validKeyAndValue.validateSync()).toBeUndefined()

    const scalarBoundary = validDocuments().graphNode
    scalarBoundary.attributes = { snippet: validPair.repeat(8000) }
    expect(scalarBoundary.validateSync()).toBeUndefined()

    const scalarOverflow = validDocuments().graphNode
    scalarOverflow.attributes = { snippet: `${validPair.repeat(8000)}a` }
    expectInvalid(scalarOverflow, 'attributes')
  })

  test.each([
    ['snapshot', () => validDocuments().graphSnapshot, (document, value) => { document.metadata = { scope: { runtimeId: value } } }],
    ['node', () => validDocuments().graphNode, (document, value) => { document.attributes = { scope: { runtimeId: value } } }],
  ])('enforces exact trimmed 240-scalar scope values on %s', (_label, createDocument, assignScope) => {
    const whitespace = createDocument()
    assignScope(whitespace, ' runtime-one ')
    expectInvalid(whitespace, _label === 'snapshot' ? 'metadata' : 'attributes')

    const rawOverflow = createDocument()
    assignScope(rawOverflow, 'x'.repeat(241))
    expectInvalid(rawOverflow, _label === 'snapshot' ? 'metadata' : 'attributes')

    const boundary = createDocument()
    assignScope(boundary, '😀'.repeat(240))
    expect(boundary.validateSync()).toBeUndefined()
    const storedValue = _label === 'snapshot'
      ? boundary.metadata.scope.runtimeId
      : boundary.attributes.scope.runtimeId
    expect(storedValue).toBe('😀'.repeat(240))
  })

  test('enforces exact NODE and EDGE attribute allowlists and bounded NODE scope', () => {
    const nodeWithEdgeField = validDocuments().graphNode
    nodeWithEdgeField.attributes = { relationshipDefinitionKey: 'supplies' }
    expectInvalid(nodeWithEdgeField, 'attributes')

    const edgeWithNodeField = validDocuments().graphEdge
    edgeWithNodeField.attributes = { nodeType: 'COMPANY' }
    expectInvalid(edgeWithNodeField, 'attributes')

    const duplicatedTypedIdentity = validDocuments().graphNode
    duplicatedTypedIdentity.attributes = { snapshotId: 'snapshot-1' }
    expectInvalid(duplicatedTypedIdentity, 'attributes')

    const invalidScope = validDocuments().graphNode
    invalidScope.attributes = { scope: { frameworkId: 'framework-1', sectionKey: 'overview' } }
    expectInvalid(invalidScope, 'attributes')

    for (const scope of ['GLOBAL', 'SECTION']) {
      const domainScopedNode = validDocuments().graphNode
      domainScopedNode.attributes = {
        scope,
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
      }
      expect(domainScopedNode.validateSync()).toBeUndefined()
    }

    for (const scope of ['global', ' GLOBAL ', 'UNKNOWN']) {
      const invalidDomainScope = validDocuments().graphNode
      invalidDomainScope.attributes = { scope }
      expectInvalid(invalidDomainScope, 'attributes')
    }
  })

  test('preserves every existing index key shape and option', () => {
    const scopedIndexes = (keyField, versionName, currentName) => [
      [{ customerId: 1, tenantId: 1, runtimeInstanceId: 1, [keyField]: 1, stateVersion: 1 }, { unique: true, name: versionName, background: true }],
      [{ customerId: 1, tenantId: 1, runtimeInstanceId: 1, [keyField]: 1, current: 1 }, { unique: true, name: currentName, partialFilterExpression: { current: true }, background: true }],
    ]
    const expected = {
      section: scopedIndexes('sectionKey', 'unique_runtime_state_section_version', 'unique_current_runtime_state_section'),
      evidenceSource: scopedIndexes('sourceId', 'unique_runtime_evidence_source_version', 'unique_current_runtime_evidence_source'),
      evidenceObject: scopedIndexes('evidenceObjectId', 'unique_runtime_evidence_object_version', 'unique_current_runtime_evidence_object'),
      graphSnapshot: [
        [{ customerId: 1, tenantId: 1, runtimeInstanceId: 1, graphVersion: 1, stateVersion: 1 }, { unique: true, name: 'unique_runtime_graph_snapshot_version', background: true }],
        [{ customerId: 1, tenantId: 1, runtimeInstanceId: 1, current: 1 }, { unique: true, name: 'unique_current_runtime_graph_snapshot', partialFilterExpression: { current: true }, background: true }],
      ],
      graphElement: scopedIndexes('elementKey', 'unique_runtime_graph_element_version', 'unique_current_runtime_graph_element'),
    }
    expect(runtimeStateSectionSchema.indexes()).toEqual(expected.section)
    expect(runtimeEvidenceSourceSchema.indexes()).toEqual(expected.evidenceSource)
    expect(runtimeEvidenceObjectSchema.indexes()).toEqual(expected.evidenceObject)
    expect(runtimeGraphSnapshotSchema.indexes()).toEqual(expected.graphSnapshot)
    expect(runtimeGraphElementSchema.indexes()).toEqual(expected.graphElement)
  })
})
