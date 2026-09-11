import { describe, test, expect } from '@jest/globals'
import { previewKnowledgePackImportMetadata, assertKnowledgePackImportMetadata } from '../services/knowledgePackImportMetadataService.js'

const source = `---
name: Example pack
knowledge_asset_id: EX-001
capability_key: example-pack
draft_pack_type: SYSTEM
purpose_category: SYSTEM
knowledge_layer: SYSTEM
execution_mode: PROVIDER_CONTEXT
visibility: PLATFORM
workspace_compatibility: [OUTCOME]
runtime_consumers: [Outcome Studio]
description: |
  A multiline source description.
  Preserved for import.
---
# Example
Canonical body is unchanged.
`

describe('SS-003 import metadata contract', () => {
  test('hydrates all eleven fields from canonical YAML with multiline description', () => {
    const result = previewKnowledgePackImportMetadata({ extractedText: source })
    expect(result.fieldErrors).toEqual({})
    expect(Object.keys(result.metadata)).toHaveLength(11)
    expect(result.metadata).toMatchObject({ label: 'Example pack', knowledgeAssetId: 'EX-001',
      capabilityKey: 'example-pack', packType: 'SYSTEM', purposeCategory: 'SYSTEM', knowledgeLayer: 'SYSTEM',
      executionMode: 'PROVIDER_CONTEXT', visibility: 'PLATFORM', workspaceCompatibility: ['OUTCOME'],
      runtimeConsumers: ['Outcome Studio'], description: 'A multiline source description.\nPreserved for import.\n' })
  })
  test.each([
    ['name: Example pack', 'name: [bad]', 'label'],
    ['draft_pack_type: SYSTEM', 'draft_pack_type: UNKNOWN', 'packType'],
    ['runtime_consumers: [Outcome Studio]', 'runtime_consumers: Outcome Studio', 'runtimeConsumers'],
    ['workspace_compatibility: [OUTCOME]', 'workspace_compatibility: [OUTCOME, OUTCOME]', 'workspaceCompatibility'],
    ['name: Example pack', 'name: Example pack\nlabel: Conflicting', 'label'],
    ['name: Example pack', 'name: Example pack\nname: Duplicate', 'extractedText'],
    ['name: Example pack', 'name: &anchor Example pack', 'extractedText'],
    ['name: Example pack', '__proto__: {polluted: true}', 'extractedText'],
    ['visibility: PLATFORM', 'visibility: {bad: shape}', 'visibility'],
    ['knowledge_asset_id: EX-001', 'knowledge_asset_id: null', 'knowledgeAssetId'],
    ['knowledge_asset_id: EX-001', 'knowledge_asset_id: []', 'knowledgeAssetId'],
    ['knowledge_asset_id: EX-001', 'knowledge_asset_id: ""', 'knowledgeAssetId'],
  ])('blocks invalid declared metadata even with override: %s', (from, to, field) => {
    const result = previewKnowledgePackImportMetadata({ extractedText: source.replace(from, to),
      metadata: { [field]: field === 'knowledgeAssetId' ? 'EX-002' : 'SYSTEM' }, metadataOverrides: [field] })
    expect(result.fieldErrors[field]).toBeTruthy()
  })
  test('allows valid explicit overrides, blocks unacknowledged conflict and immutable ID changes', () => {
    expect(previewKnowledgePackImportMetadata({ extractedText: source, metadata: { label: 'New name' } }).fieldErrors.label).toMatch(/conflicts/)
    const valid = previewKnowledgePackImportMetadata({ extractedText: source, metadata: { label: 'New name' }, metadataOverrides: ['label'] })
    expect(valid.fieldErrors).toEqual({})
    expect(valid.sourceMetadata.label).toBe('Example pack')
    expect(valid.metadata.label).toBe('New name')
    expect(previewKnowledgePackImportMetadata({ extractedText: source, metadata: { knowledgeAssetId: 'EX-002' }, metadataOverrides: ['knowledgeAssetId'] }).fieldErrors.knowledgeAssetId).toMatch(/must match/)
  })
  test('missing required metadata is actionable and valid manual completion resolves it', () => {
    const missing = source.replace('capability_key: example-pack\n', '')
    expect(previewKnowledgePackImportMetadata({ extractedText: missing }).fieldErrors.capabilityKey).toMatch(/missing/)
    expect(previewKnowledgePackImportMetadata({ extractedText: missing, metadata: { capabilityKey: 'completed' } }).fieldErrors).toEqual({})
  })
  test('supports BOM/CRLF, explicit empty consumers and rejects missing closing delimiter', () => {
    expect(previewKnowledgePackImportMetadata({ extractedText: '\uFEFF' + source.replaceAll('\n', '\r\n') }).fieldErrors).toEqual({})
    expect(previewKnowledgePackImportMetadata({ extractedText: source.replace('[Outcome Studio]', '[]') }).metadata.runtimeConsumers).toEqual([])
    expect(previewKnowledgePackImportMetadata({ extractedText: source.replace('\n---\n#', '\n#') }).fieldErrors.extractedText).toBeTruthy()
  })
  test('creation independently rejects source conflicts and unknown override fields', () => {
    expect(() => assertKnowledgePackImportMetadata({ extractedText: source, label: 'Injected' })).toThrow(/metadata errors/)
    expect(() => assertKnowledgePackImportMetadata({ extractedText: source, metadataOverrides: ['dependencyReferences'] })).toThrow(/metadata errors/)
    expect(assertKnowledgePackImportMetadata({ extractedText: source, description: '', metadataOverrides: ['description'] }).metadata.description).toBe('')
  })
  test('preview rejects OUTPUT_SCHEMA-only compatibility on other pack types', () => {
    expect(previewKnowledgePackImportMetadata({ extractedText: source.replace('draft_pack_type: SYSTEM',
      'draft_pack_type: STYLE\ncompatible_output_types: [OT-001]') }).fieldErrors.packType).toMatch(/OUTPUT_SCHEMA/)
  })
})
