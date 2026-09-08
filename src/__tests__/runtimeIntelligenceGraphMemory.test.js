import crypto from 'node:crypto'
import { describe, expect, test } from '@jest/globals'
import {
  buildRuntimeIntelligenceGraphForFrameworkState,
  hashRuntimeIntelligenceGraphValue,
} from '../services/runtimeIntelligenceGraphService.js'

const isPlainObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value))

// Compatibility oracle for the pre-optimization graph hash serializer.
const legacyStableStringify = (value) => {
  if (value === null || value === undefined) return ''
  if (!isPlainObject(value) && !Array.isArray(value)) return String(value)
  const normalize = (candidate) => {
    if (Array.isArray(candidate)) return candidate.map(normalize)
    if (!isPlainObject(candidate)) return candidate
    return Object.keys(candidate)
      .sort()
      .reduce((acc, key) => ({ ...acc, [key]: normalize(candidate[key]) }), {})
  }
  return JSON.stringify(normalize(value))
}

const legacyHash = (value) =>
  `sha256:${crypto.createHash('sha256').update(legacyStableStringify(value)).digest('hex')}`

const graphFixture = (frameworkState) => buildRuntimeIntelligenceGraphForFrameworkState({
  frameworkPackage: {
    frameworkKey: 'FIXTURE',
    packageKey: 'fixture-package',
    version: '1.0.0',
    sections: [],
  },
  frameworkState,
  runtimeInstance: {
    _id: 'runtime-fixture',
    runtimeInstanceKey: 'runtime-fixture',
    runtimeType: 'VALUE_NARRATIVE',
    frameworkKey: 'FIXTURE',
    packageKey: 'fixture-package',
    packageVersion: '1.0.0',
    customerId: 'customer-fixture',
    tenantId: 'tenant-fixture',
  },
})

describe('runtime intelligence graph memory boundaries', () => {
  test('preserves graph hash output for supported JSON values', () => {
    const value = {
      z: [undefined, null, 'text', NaN, Infinity, -0],
      a: {
        date: new Date('2026-09-08T12:00:00.000Z'),
        nested: { beta: true, alpha: 7 },
      },
      omitted: undefined,
    }

    expect(hashRuntimeIntelligenceGraphValue(value)).toBe(legacyHash(value))
  })

  test('ignores graph aliases in the source hash without mutating framework state', () => {
    const frameworkState = {
      intelligence_graph: { graphHash: 'old-a', nodes: [{ nodeId: 'a' }] },
      intelligenceGraph: { graphHash: 'old-b', nodes: [{ nodeId: 'b' }] },
      evidence_pack: { accepted: false, evidenceObjects: [] },
      sections: {},
    }
    const first = graphFixture(frameworkState)
    expect(frameworkState.intelligence_graph.graphHash).toBe('old-a')
    expect(frameworkState.intelligenceGraph.nodes).toEqual([{ nodeId: 'b' }])

    frameworkState.intelligence_graph.graphHash = 'changed-a'
    frameworkState.intelligenceGraph.nodes.push({ nodeId: 'changed-b' })
    const second = graphFixture(frameworkState)

    expect(first.build.sourceHash).toBe(second.build.sourceHash)
    expect(frameworkState.intelligence_graph.graphHash).toBe('changed-a')
    expect(frameworkState.intelligenceGraph.nodes).toEqual([{ nodeId: 'b' }, { nodeId: 'changed-b' }])
  })
})
