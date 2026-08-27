import { describe, expect, test } from '@jest/globals'
import { createHash } from 'node:crypto'
import mongoose from 'mongoose'

import {
  SS014_LEGACY_CANONICAL_ALGORITHM,
  SS014_LEGACY_CANONICAL_CAPS,
  SS014_LEGACY_CANONICAL_ERROR_CODES,
  SS014_LEGACY_CANONICAL_LOGICAL_PATHS,
  SS014_LEGACY_CANONICAL_MAX_BYTES,
  SS014_LEGACY_SOURCE_HASH_STATUS,
  createSs014LegacyCanonicalMappingManifest,
  serializeSs014LegacyDomains,
} from '../services/ss014LegacyDomainCanonicalSerializer.js'

const id = (value) => new mongoose.Types.ObjectId(value)

const makeInput = (overrides = {}) => ({
  rawBsonBytes: 1234,
  sections: {
    '\u{1F600}': { generated: { summary: 'later' }, accepted: null },
    customer_context: { accepted: { summary: 'accepted' }, omitted: undefined },
  },
  evidencePack: {
    sourceRegistry: [
      { sourceId: 'source-b', sourceType: 'FILE', capturedAt: new Date('2026-01-02T00:00:00.000Z') },
      { sourceId: 'source-a', sourceType: 'WEBSITE', capturedAt: new Date('2026-01-01T00:00:00.000Z') },
    ],
    evidenceObjects: [
      { evidenceObjectId: 'evidence-b', sourceId: 'source-b', confidence: 0.75 },
      { evidenceObjectId: 'evidence-a', sourceId: 'source-a', confidence: 0.5 },
    ],
  },
  intelligenceGraph: {
    graphVersion: 'g1',
    nodes: [{ id: 'node-b', label: 'B' }, { nodeId: 'node-a', label: 'A' }],
    edges: [{ id: 'edge-a', from: 'node-a', to: 'node-b', relation: 'SUPPORTS' }],
  },
  ...overrides,
})

const expectFailure = (callback, code) => {
  expect(callback).toThrow(expect.objectContaining({ code }))
}

const captureFailure = (callback) => {
  try {
    callback()
  } catch (error) {
    return error
  }
  throw new Error('Expected callback to fail.')
}

describe('SS-014 legacy domain canonical serializer', () => {
  test('emits deterministic compact domain JSON and source-set hashes', () => {
    const result = serializeSs014LegacyDomains(makeInput())

    expect(result.algorithm).toBe(SS014_LEGACY_CANONICAL_ALGORITHM)
    expect(result.sourceHashStatus).toBe(SS014_LEGACY_SOURCE_HASH_STATUS)
    expect(result.rawBsonBytes).toBe(1234)
    expect(Object.values(result.domains).map(({ logicalPath }) => logicalPath)).toEqual([
      SS014_LEGACY_CANONICAL_LOGICAL_PATHS.sections,
      SS014_LEGACY_CANONICAL_LOGICAL_PATHS.evidencePack,
      SS014_LEGACY_CANONICAL_LOGICAL_PATHS.intelligenceGraph,
    ])
    expect(result.domains.sections.canonicalJson).toBe('{"customer_context":{"accepted":{"summary":"accepted"}},"😀":{"accepted":null,"generated":{"summary":"later"}}}')
    expect(result.domains.evidencePack.canonicalJson).toBe('{"evidenceObjects":[{"confidence":0.5,"evidenceObjectId":"evidence-a","sourceId":"source-a"},{"confidence":0.75,"evidenceObjectId":"evidence-b","sourceId":"source-b"}],"sourceRegistry":[{"capturedAt":"2026-01-01T00:00:00.000Z","sourceId":"source-a","sourceType":"WEBSITE"},{"capturedAt":"2026-01-02T00:00:00.000Z","sourceId":"source-b","sourceType":"FILE"}]}')
    expect(result.domains.intelligenceGraph.canonicalJson).toBe('{"edges":[{"from":"node-a","id":"edge-a","relation":"SUPPORTS","to":"node-b"}],"graphVersion":"g1","nodes":[{"label":"A","nodeId":"node-a"},{"id":"node-b","label":"B"}]}')
    for (const domain of Object.values(result.domains)) {
      expect(domain.sourceHash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(domain.byteLength).toBe(Buffer.byteLength(domain.canonicalJson, 'utf8'))
    }
    expect(result.sourceSetHash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  test('normalizes keyed collection order but preserves unrelated array order', () => {
    const input = makeInput()
    const reordered = makeInput({
      sections: input.sections,
      evidencePack: {
        sourceRegistry: [...input.evidencePack.sourceRegistry].reverse(),
        evidenceObjects: [...input.evidencePack.evidenceObjects].reverse(),
        orderSensitive: ['second', 'first'],
      },
      intelligenceGraph: {
        ...input.intelligenceGraph,
        nodes: [...input.intelligenceGraph.nodes].reverse(),
        edges: [...input.intelligenceGraph.edges],
      },
    })
    const first = serializeSs014LegacyDomains(makeInput({
      evidencePack: { ...input.evidencePack, orderSensitive: ['second', 'first'] },
    }))
    const second = serializeSs014LegacyDomains(reordered)
    expect(second.sourceSetHash).toBe(first.sourceSetHash)
  })

  test('normalizes ObjectIds and valid Dates while rejecting custom Date properties and fake ObjectIds', () => {
    const valid = serializeSs014LegacyDomains(makeInput({
      sections: { identity: { id: id('6a6c8115bb9cebc18a1eca9c'), at: new Date('2026-08-25T12:00:00.000Z') } },
    }))
    expect(valid.domains.sections.canonicalJson).toContain('6a6c8115bb9cebc18a1eca9c')
    expect(valid.domains.sections.canonicalJson).toContain('2026-08-25T12:00:00.000Z')

    const customDate = new Date('2026-08-25T12:00:00.000Z')
    customDate.extra = true
    expectFailure(() => serializeSs014LegacyDomains(makeInput({ sections: { identity: { at: customDate } } })), SS014_LEGACY_CANONICAL_ERROR_CODES.REDACTION_FAILED)
    expectFailure(() => serializeSs014LegacyDomains(makeInput({ sections: { identity: { id: { toHexString: () => '6a6c8115bb9cebc18a1eca9c' } } } })), SS014_LEGACY_CANONICAL_ERROR_CODES.REDACTION_FAILED)
  })

  test('derives alias-free graph keys from exact preimage and rejects unresolved endpoints', () => {
    const derivedNode = { label: 'A' }
    const derivedKey = `sha256:${createHash('sha256').update('{"label":"A"}', 'utf8').digest('hex')}`
    const result = serializeSs014LegacyDomains(makeInput({
      intelligenceGraph: {
        nodes: [derivedNode],
        edges: [{ from: derivedKey, to: derivedKey, relation: 'SELF' }],
      },
    }))
    expect(result.domains.intelligenceGraph.canonicalJson).toContain('"label":"A"')
    expectFailure(() => serializeSs014LegacyDomains(makeInput({
      intelligenceGraph: { nodes: [{ id: 'node-a' }], edges: [{ from: 'missing', to: 'node-a' }] },
    })), SS014_LEGACY_CANONICAL_ERROR_CODES.MAPPING_REQUIRED)
  })

  test('rejects duplicate identities and ambiguous aliases', () => {
    expectFailure(() => serializeSs014LegacyDomains(makeInput({
      evidencePack: {
        sourceRegistry: [{ sourceId: 'source-a' }, { sourceId: 'source-a' }],
        evidenceObjects: [],
      },
    })), SS014_LEGACY_CANONICAL_ERROR_CODES.MAPPING_REQUIRED)
    expectFailure(() => serializeSs014LegacyDomains(makeInput({
      intelligenceGraph: {
        nodes: [{ id: 'node-a', nodeId: 'node-a' }],
        edges: [],
      },
    })), SS014_LEGACY_CANONICAL_ERROR_CODES.MAPPING_REQUIRED)
  })

  test('fails closed for envelope, descriptor, scalar and array drift', () => {
    expectFailure(() => serializeSs014LegacyDomains({ ...makeInput(), framework_state: {} }), SS014_LEGACY_CANONICAL_ERROR_CODES.REDACTION_FAILED)
    const withGetter = makeInput()
    Object.defineProperty(withGetter.sections, 'getter', { enumerable: true, get: () => ({}) })
    expectFailure(() => serializeSs014LegacyDomains(withGetter), SS014_LEGACY_CANONICAL_ERROR_CODES.REDACTION_FAILED)
    expectFailure(() => serializeSs014LegacyDomains(makeInput({ rawBsonBytes: undefined })), SS014_LEGACY_CANONICAL_ERROR_CODES.REDACTION_FAILED)
    expectFailure(() => serializeSs014LegacyDomains(makeInput({ rawBsonBytes: 1.5 })), SS014_LEGACY_CANONICAL_ERROR_CODES.REDACTION_FAILED)
    expectFailure(() => serializeSs014LegacyDomains(makeInput({ rawBsonBytes: Number.NaN })), SS014_LEGACY_CANONICAL_ERROR_CODES.REDACTION_FAILED)
    expectFailure(() => serializeSs014LegacyDomains(makeInput({ sections: { bad: { value: Number.POSITIVE_INFINITY } } })), SS014_LEGACY_CANONICAL_ERROR_CODES.REDACTION_FAILED)
    const omittedUndefined = serializeSs014LegacyDomains(makeInput({ sections: { bad: { value: undefined } }, evidencePack: { sourceRegistry: [], evidenceObjects: [] }, intelligenceGraph: { nodes: [], edges: [] } }))
    expect(omittedUndefined.domains.sections.canonicalJson).toBe('{"bad":{}}')
    const sparse = makeInput()
    delete sparse.evidencePack.evidenceObjects[0]
    expectFailure(() => serializeSs014LegacyDomains(sparse), SS014_LEGACY_CANONICAL_ERROR_CODES.REDACTION_FAILED)

    const revoked = Proxy.revocable(makeInput().sections, {})
    revoked.revoke()
    expectFailure(() => serializeSs014LegacyDomains(makeInput({ sections: revoked.proxy })), SS014_LEGACY_CANONICAL_ERROR_CODES.REDACTION_FAILED)
    expectFailure(() => serializeSs014LegacyDomains(makeInput({ sections: new Proxy({ safe: { value: 1 } }, {}) })), SS014_LEGACY_CANONICAL_ERROR_CODES.REDACTION_FAILED)
    const setter = makeInput()
    Object.defineProperty(setter.sections, 'setter', { enumerable: true, set: () => {} })
    expectFailure(() => serializeSs014LegacyDomains(setter), SS014_LEGACY_CANONICAL_ERROR_CODES.REDACTION_FAILED)
    expectFailure(() => serializeSs014LegacyDomains(makeInput({ sections: { bad: { value: Number.MAX_SAFE_INTEGER + 1 } } })), SS014_LEGACY_CANONICAL_ERROR_CODES.REDACTION_FAILED)
  })

  test('enforces exact item and byte caps', () => {
    const tooManySections = Object.fromEntries(Array.from({ length: SS014_LEGACY_CANONICAL_CAPS.sections + 1 }, (_, index) => [`s-${index}`, {}]))
    expectFailure(() => serializeSs014LegacyDomains(makeInput({ sections: tooManySections })), SS014_LEGACY_CANONICAL_ERROR_CODES.CAP_EXCEEDED)
    const tooManyEvidence = Array.from({ length: SS014_LEGACY_CANONICAL_CAPS.evidenceObjects + 1 }, (_, index) => ({ evidenceObjectId: `e-${index}`, sourceId: 'source-a' }))
    expectFailure(() => serializeSs014LegacyDomains(makeInput({ evidencePack: { sourceRegistry: [{ sourceId: 'source-a' }], evidenceObjects: tooManyEvidence } })), SS014_LEGACY_CANONICAL_ERROR_CODES.CAP_EXCEEDED)
    expectFailure(() => serializeSs014LegacyDomains(makeInput({ rawBsonBytes: SS014_LEGACY_CANONICAL_MAX_BYTES + 1 })), SS014_LEGACY_CANONICAL_ERROR_CODES.CAP_EXCEEDED)
  })

  test('emits an exact deterministic mapping manifest without changing serializer output', () => {
    const input = makeInput()
    const expectedSerializer = serializeSs014LegacyDomains(input)
    const result = createSs014LegacyCanonicalMappingManifest(input)

    expect(Object.keys(result)).toEqual(['serializerResult', 'mappingManifest'])
    expect(Object.keys(result.mappingManifest)).toEqual(['sections', 'evidenceSources', 'evidenceObjects', 'graph'])
    expect(Object.keys(result.mappingManifest.sections[0])).toEqual(['sectionKey', 'value'])
    expect(Object.keys(result.mappingManifest.evidenceSources[0])).toEqual(['sourceId', 'value'])
    expect(Object.keys(result.mappingManifest.evidenceObjects[0])).toEqual(['evidenceObjectId', 'sourceId', 'value'])
    expect(Object.keys(result.mappingManifest.graph)).toEqual(['graphVersion', 'snapshotId', 'metadata', 'nodes', 'edges'])
    expect(Object.keys(result.mappingManifest.graph.nodes[0])).toEqual(['elementKey', 'value'])
    expect(Object.keys(result.mappingManifest.graph.edges[0])).toEqual(['elementKey', 'fromElementKey', 'toElementKey', 'value'])
    expect(result.serializerResult).toEqual(expectedSerializer)
    expect(result.mappingManifest.sections.map(({ sectionKey }) => sectionKey)).toEqual(['customer_context', '😀'])
    expect(result.mappingManifest.evidenceSources.map(({ sourceId }) => sourceId)).toEqual(['source-a', 'source-b'])
    expect(result.mappingManifest.evidenceObjects.map(({ evidenceObjectId }) => evidenceObjectId)).toEqual(['evidence-a', 'evidence-b'])
    expect(result.mappingManifest.graph).toMatchObject({
      graphVersion: 'g1',
      snapshotId: `legacy:${expectedSerializer.domains.intelligenceGraph.sourceHash.slice(7)}`,
      nodes: [{ elementKey: 'node-a' }, { elementKey: 'node-b' }],
      edges: [{ elementKey: 'edge-a', fromElementKey: 'node-a', toElementKey: 'node-b' }],
    })
    expect(result.mappingManifest.graph.metadata).toEqual({ graphVersion: 'g1' })

    const reordered = makeInput({
      evidencePack: {
        sourceRegistry: [...input.evidencePack.sourceRegistry].reverse(),
        evidenceObjects: [...input.evidencePack.evidenceObjects].reverse(),
      },
      intelligenceGraph: {
        ...input.intelligenceGraph,
        nodes: [...input.intelligenceGraph.nodes].reverse(),
      },
    })
    expect(createSs014LegacyCanonicalMappingManifest(reordered)).toEqual(result)
  })

  test('reuses canonical fallback graph keys and returns detached normalized values', () => {
    const node = { label: 'A' }
    const nodeKey = `sha256:${createHash('sha256').update('{"label":"A"}', 'utf8').digest('hex')}`
    const input = makeInput({
      intelligenceGraph: {
        graphVersion: 'g-derived',
        nodes: [node],
        edges: [{ from: nodeKey, to: nodeKey, relation: 'SELF' }],
      },
    })
    const first = createSs014LegacyCanonicalMappingManifest(input)
    expect(first.mappingManifest.graph.nodes[0].elementKey).toBe(nodeKey)
    expect(first.mappingManifest.graph.edges[0]).toMatchObject({ fromElementKey: nodeKey, toElementKey: nodeKey })

    node.label = 'changed'
    expect(first.mappingManifest.graph.nodes[0].value.label).toBe('A')
    first.mappingManifest.graph.nodes[0].value.label = 'mutated-result'
    expect(createSs014LegacyCanonicalMappingManifest(makeInput({
      intelligenceGraph: {
        graphVersion: 'g-derived',
        nodes: [{ label: 'A' }],
        edges: [{ from: nodeKey, to: nodeKey, relation: 'SELF' }],
      },
    })).mappingManifest.graph.nodes[0].value.label).toBe('A')
  })

  test('keeps manifest-only failures separate from existing serializer behavior', () => {
    const missingVersion = makeInput({
      intelligenceGraph: { nodes: [{ id: 'node-a' }], edges: [] },
    })
    expect(() => serializeSs014LegacyDomains(missingVersion)).not.toThrow()
    expectFailure(
      () => createSs014LegacyCanonicalMappingManifest(missingVersion),
      SS014_LEGACY_CANONICAL_ERROR_CODES.MAPPING_REQUIRED,
    )

    const crossFamilyCollision = makeInput({
      intelligenceGraph: {
        graphVersion: 'g1',
        nodes: [{ id: 'shared-key' }],
        edges: [{ id: 'shared-key', from: 'shared-key', to: 'shared-key' }],
      },
    })
    expect(() => serializeSs014LegacyDomains(crossFamilyCollision)).not.toThrow()
    expectFailure(
      () => createSs014LegacyCanonicalMappingManifest(crossFamilyCollision),
      SS014_LEGACY_CANONICAL_ERROR_CODES.MAPPING_REQUIRED,
    )
  })

  test('propagates existing graph failures and exposes the exact fallback edge key', () => {
    const fallbackEdge = { from: 'node-a', relation: 'SELF', to: 'node-a' }
    const expectedEdgeKey = `sha256:${createHash('sha256').update('{"from":"node-a","relation":"SELF","to":"node-a"}', 'utf8').digest('hex')}`
    const manifest = createSs014LegacyCanonicalMappingManifest(makeInput({
      intelligenceGraph: { graphVersion: 'g1', nodes: [{ id: 'node-a' }], edges: [fallbackEdge] },
    }))
    expect(manifest.mappingManifest.graph.edges[0].elementKey).toBe(expectedEdgeKey)

    for (const graph of [
      { graphVersion: 'g1', nodes: [{ id: 'node-a' }], edges: [{ id: 'edge-a', from: 'node-a' }] },
      { graphVersion: 'g1', nodes: [{ id: 'node-a' }], edges: [{ id: 'edge-a', from: 'node-a', to: 'node-a' }, { id: 'edge-a', from: 'node-a', to: 'node-a' }] },
      { graphVersion: 'g1', nodes: [{ id: 'node-a', nodeId: 'node-a' }], edges: [] },
      { graphVersion: 'g1', nodes: [{ id: 'node-a' }], edges: [{ from: 'missing', to: 'node-a' }] },
    ]) {
      expectFailure(
        () => createSs014LegacyCanonicalMappingManifest(makeInput({ intelligenceGraph: graph })),
        SS014_LEGACY_CANONICAL_ERROR_CODES.MAPPING_REQUIRED,
      )
    }
  })

  test('preserves existing failure precedence ahead of manifest-only checks', () => {
    const envelopeError = captureFailure(() => createSs014LegacyCanonicalMappingManifest({
      ...makeInput({ intelligenceGraph: { nodes: [], edges: [] } }),
      extra: true,
    }))
    expect(envelopeError.code).toBe(SS014_LEGACY_CANONICAL_ERROR_CODES.REDACTION_FAILED)
    expect(envelopeError.details.reason).toContain('envelope keys')

    const capError = captureFailure(() => createSs014LegacyCanonicalMappingManifest(makeInput({
      rawBsonBytes: SS014_LEGACY_CANONICAL_MAX_BYTES + 1,
      intelligenceGraph: { nodes: [], edges: [] },
    })))
    expect(capError.code).toBe(SS014_LEGACY_CANONICAL_ERROR_CODES.CAP_EXCEEDED)
    expect(capError.details.reason).toContain('raw BSON cap')

    const evidenceError = captureFailure(() => createSs014LegacyCanonicalMappingManifest(makeInput({
      evidencePack: {
        sourceRegistry: [{ sourceId: 'source-a' }],
        evidenceObjects: [{ evidenceObjectId: 'evidence-a', sourceId: 'missing' }],
      },
      intelligenceGraph: { nodes: [], edges: [] },
    })))
    expect(evidenceError.code).toBe(SS014_LEGACY_CANONICAL_ERROR_CODES.MAPPING_REQUIRED)
    expect(evidenceError.details.reason).toContain('unknown sourceId')

    const graphError = captureFailure(() => createSs014LegacyCanonicalMappingManifest(makeInput({
      intelligenceGraph: { nodes: [{ id: 'node-a' }], edges: [{ from: 'missing', to: 'node-a' }] },
    })))
    expect(graphError.code).toBe(SS014_LEGACY_CANONICAL_ERROR_CODES.MAPPING_REQUIRED)
    expect(graphError.details.reason).toContain('unknown node key')
  })
})
