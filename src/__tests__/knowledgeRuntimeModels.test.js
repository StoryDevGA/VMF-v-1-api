import mongoose from 'mongoose'
import { describe, test, expect } from '@jest/globals'

import FrameworkPackage from '../models/FrameworkPackage.js'
import RuntimeSkill from '../models/RuntimeSkill.js'
import KnowledgePack from '../models/KnowledgePack.js'
import KnowledgePackVersion from '../models/KnowledgePackVersion.js'
import KnowledgePackActivation from '../models/KnowledgePackActivation.js'
import KnowledgePackManifest from '../models/KnowledgePackManifest.js'
import OutcomeAsset from '../models/OutcomeAsset.js'
import OutcomeAssetVersion from '../models/OutcomeAssetVersion.js'

const objectId = () => new mongoose.Types.ObjectId()

const hasIndex = (model, expectedFields) =>
  model.schema.indexes().some(([fields]) =>
    JSON.stringify(fields) === JSON.stringify(expectedFields))

const getIndexOptions = (model, expectedFields) =>
  model.schema.indexes().find(([fields]) =>
    JSON.stringify(fields) === JSON.stringify(expectedFields))?.[1]

const makeOutcomeAssetPayload = () => ({
  outcomeAssetId: 'asset-vmf-summary-001',
  sessionId: 'session-vmf-001',
  tenantId: objectId(),
  customerId: objectId(),
  runtimeInstanceId: objectId(),
  runtimeInstanceKey: ' VMF-RUNTIME-001 ',
  runtimeType: ' value_narrative ',
  frameworkKey: ' vmf ',
  packageKey: 'standard-package-vmf-3-1-rkm',
  packageVersion: '3.1',
  projectId: '   ',
  outcomeId: '',
  outputTypeKey: ' executive_brief ',
  outputTypeLabel: 'Executive Brief',
  sourceOutputAssetId: 'source-output-001',
  generatedBy: objectId(),
})

const makeOutcomeAssetVersionPayload = () => ({
  outcomeAssetVersionId: 'asset-vmf-summary-001-v1',
  outcomeAssetId: 'asset-vmf-summary-001',
  sessionId: 'session-vmf-001',
  tenantId: objectId(),
  customerId: objectId(),
  runtimeInstanceId: objectId(),
  runtimeInstanceKey: ' VMF-RUNTIME-001 ',
  runtimeType: ' value_narrative ',
  frameworkKey: ' vmf ',
  packageKey: 'standard-package-vmf-3-1-rkm',
  packageVersion: '3.1',
  projectId: '   ',
  outcomeId: '',
  versionNumber: 1,
  outputTypeKey: ' executive_brief ',
  outputTypeLabel: 'Executive Brief',
  sourceOutputAssetId: 'source-output-001',
  generatedBy: objectId(),
  customerContent: { markdown: '# Summary' },
})

const makeKnowledgePackActivationPayload = (overrides = {}) => ({
  packType: 'STYLE',
  packKey: 'executive-board-style',
  versionId: 'kpv-style-executive-board-style-1-0-0-global',
  semanticVersion: '1.0.0',
  status: 'ACTIVE',
  knowledgeLayer: 'STYLE',
  capabilityKey: 'executive-board',
  workspaceCompatibility: ['OUTCOME'],
  ...overrides,
})

describe('Knowledge Runtime model contracts', () => {
  test('serializes stable public ids for framework packages and runtime skills', () => {
    const frameworkPackage = new FrameworkPackage({
      frameworkKey: 'VMF',
      frameworkName: 'Value Management Framework',
      version: '3.1.0',
      packageKey: 'standard-package-vmf-3-1-rkm',
      createdBy: objectId(),
      updatedBy: objectId(),
    })
    const runtimeSkill = new RuntimeSkill({
      key: 'truth-certification-resolver',
      name: 'Truth Certification Resolver',
      description: 'Resolves truth certification rules.',
      category: 'TRUTH',
      supportedFrameworkKeys: ['VMF'],
      skillRoleKey: 'GOVERNANCE',
      stableId: 'skill-truth-certification-resolver',
      createdBy: objectId(),
      updatedBy: objectId(),
    })

    const serializedPackage = frameworkPackage.toJSON()
    const serializedSkill = runtimeSkill.toJSON()

    expect(serializedPackage.id).toBe('standard-package-vmf-3-1-rkm')
    expect(serializedPackage._id).toBeUndefined()
    expect(serializedSkill.id).toBe('skill-truth-certification-resolver')
    expect(serializedSkill.stableId).toBeUndefined()
    expect(serializedSkill._id).toBeUndefined()
  })

  test('declares resolver and output lookup indexes', () => {
    expect(hasIndex(KnowledgePackManifest, { scopeType: 1, scopeKey: 1, status: 1 })).toBe(true)
    expect(hasIndex(KnowledgePack, { purposeCategory: 1, status: 1, updatedAt: -1 })).toBe(true)
    expect(hasIndex(KnowledgePackVersion, { visibility: 1, customerId: 1, tenantId: 1, status: 1 })).toBe(true)
    expect(hasIndex(KnowledgePackVersion, { 'sourceDocuments.sourceHash': 1, scopeKey: 1 })).toBe(true)
    expect(hasIndex(KnowledgePackActivation, { purposeCategory: 1, status: 1, activatedAt: -1 })).toBe(true)
    expect(getIndexOptions(KnowledgePackActivation, {
      status: 1,
      scopeKey: 1,
      knowledgeLayer: 1,
      capabilityKey: 1,
    })).toEqual(expect.objectContaining({
      name: 'uniq_active_knowledge_capability_scope',
      unique: true,
      partialFilterExpression: {
        status: 'ACTIVE',
        knowledgeLayer: { $type: 'string' },
        capabilityKey: { $type: 'string' },
      },
    }))
    expect(hasIndex(OutcomeAsset, {
      runtimeInstanceId: 1,
      outputTypeKey: 1,
      status: 1,
      createdAt: -1,
    })).toBe(true)
  })

  test('normalizes blank project and outcome ids to null on outcome assets', async () => {
    const asset = new OutcomeAsset(makeOutcomeAssetPayload())
    const version = new OutcomeAssetVersion(makeOutcomeAssetVersionPayload())

    await expect(asset.validate()).resolves.toBeUndefined()
    await expect(version.validate()).resolves.toBeUndefined()

    expect(asset.projectId).toBeNull()
    expect(asset.outcomeId).toBeNull()
    expect(version.projectId).toBeNull()
    expect(version.outcomeId).toBeNull()
  })

  test('normalizes KP-002 reasoning category and source-document metadata', async () => {
    const customerId = objectId()
    const pack = new KnowledgePack({
      packType: ' style ',
      packKey: ' Board-Executive ',
      label: ' Board Executive Style ',
      purposeCategory: ' style ',
      executionMode: ' provider_context ',
      visibility: ' customer ',
      customerId,
      sourceAuthority: ' StorylineOS Methodology ',
      authoringMode: ' import_source_document ',
      reviewStatus: ' ready_for_review ',
      sourceMetadata: {
        importedFrom: 'Corporate Writing Guide.docx',
      },
    })
    const version = new KnowledgePackVersion({
      packType: 'style',
      packKey: ' Board-Executive ',
      semanticVersion: ' 1.2.0 ',
      purposeCategory: 'style',
      executionMode: 'provider_context',
      visibility: 'customer',
      customerId,
      contentFormat: 'docx',
      sourceAuthority: ' StorylineOS Methodology ',
      authoringMode: ' import_source_document ',
      reviewStatus: ' ready_for_review ',
      sourceDocuments: [
        {
          sourceDocumentId: ' style-doc-1 ',
          filename: ' Board Executive Style.DOCX ',
          contentType: ' application/vnd.openxmlformats-officedocument.wordprocessingml.document ',
          fileExtension: ' DOCX ',
          sourceHash: ' sha256:abc123 ',
        },
      ],
    })
    const activation = new KnowledgePackActivation({
      packType: 'style',
      packKey: 'board-executive',
      versionId: 'kpv-style-board-executive-1-2-0-customer-acme',
      semanticVersion: '1.2.0',
      purposeCategory: 'style',
      knowledgeLayer: 'style',
      capabilityKey: 'board-executive',
      workspaceCompatibility: ['outcome'],
      executionMode: 'provider_context',
      visibility: 'customer',
      customerId,
      scopeType: 'customer',
      scopeKey: ' customer:acme ',
    })

    await expect(pack.validate()).resolves.toBeUndefined()
    await expect(version.validate()).resolves.toBeUndefined()
    await expect(activation.validate()).resolves.toBeUndefined()

    expect(pack.packType).toBe('STYLE')
    expect(pack.packKey).toBe('board-executive')
    expect(pack.purposeCategory).toBe('STYLE')
    expect(pack.executionMode).toBe('PROVIDER_CONTEXT')
    expect(pack.visibility).toBe('CUSTOMER')
    expect(pack.sourceAuthority).toBe('StorylineOS Methodology')
    expect(pack.authoringMode).toBe('IMPORT_SOURCE_DOCUMENT')
    expect(pack.reviewStatus).toBe('READY_FOR_REVIEW')
    expect(version.contentFormat).toBe('DOCX')
    expect(version.sourceDocuments[0]).toEqual(expect.objectContaining({
      sourceDocumentId: 'style-doc-1',
      filename: 'Board Executive Style.DOCX',
      fileExtension: 'docx',
      sourceHash: 'sha256:abc123',
      sourceType: 'SOURCE_DOCUMENT',
    }))
    expect(activation.purposeCategory).toBe('STYLE')
    expect(activation.visibility).toBe('CUSTOMER')
  })

  test.each([
    ['knowledgeLayer', { knowledgeLayer: undefined }],
    ['capabilityKey', { capabilityKey: undefined }],
    ['workspaceCompatibility', { workspaceCompatibility: [] }],
  ])('rejects ACTIVE Knowledge Pack activations without %s', async (field, override) => {
    const activation = new KnowledgePackActivation(
      makeKnowledgePackActivationPayload(override),
    )

    await expect(activation.validate()).rejects.toThrow(new RegExp(field))
  })

  test('allows non-active legacy Knowledge Pack activations without governance metadata', async () => {
    const activation = new KnowledgePackActivation(makeKnowledgePackActivationPayload({
      status: 'ROLLED_BACK',
      knowledgeLayer: undefined,
      capabilityKey: undefined,
      workspaceCompatibility: undefined,
    }))

    await expect(activation.validate()).resolves.toBeUndefined()
  })

  test('normalizes KP-004 classification and governed dependency metadata', async () => {
    const version = new KnowledgePackVersion({
      packType: 'STYLE',
      packKey: 'executive-board-style',
      semanticVersion: '1.0.0',
      knowledgeLayer: ' style ',
      capabilityKey: ' Executive-Board ',
      workspaceCompatibility: [' outcome ', 'OUTCOME', ' advisor '],
      dependencyReferences: [
        {
          knowledgeLayer: ' output_schema ',
          requirement: ' required ',
          packType: ' output_schema ',
          packKey: ' Board-Summary ',
        },
        {
          knowledgeLayer: ' audience ',
          requirement: ' optional ',
          capabilityKey: ' Board-Audience ',
        },
      ],
    })

    await expect(version.validate()).resolves.toBeUndefined()

    expect(version.knowledgeLayer).toBe('STYLE')
    expect(version.capabilityKey).toBe('executive-board')
    expect(version.workspaceCompatibility).toEqual(['OUTCOME', 'ADVISOR'])
    expect(version.dependencyReferences.map((reference) => reference.toObject())).toEqual([
      {
        knowledgeLayer: 'OUTPUT_SCHEMA',
        requirement: 'REQUIRED',
        packType: 'OUTPUT_SCHEMA',
        packKey: 'board-summary',
      },
      {
        knowledgeLayer: 'AUDIENCE',
        requirement: 'OPTIONAL',
        capabilityKey: 'board-audience',
      },
    ])
  })

  test.each([
    {
      name: 'partial exact identity',
      dependency: {
        knowledgeLayer: 'OUTPUT_SCHEMA',
        packType: 'OUTPUT_SCHEMA',
      },
    },
    {
      name: 'both exact identity and capability selectors',
      dependency: {
        knowledgeLayer: 'OUTPUT_SCHEMA',
        packType: 'OUTPUT_SCHEMA',
        packKey: 'board-summary',
        capabilityKey: 'board-summary',
      },
    },
    {
      name: 'no selector',
      dependency: {
        knowledgeLayer: 'OUTPUT_SCHEMA',
      },
    },
  ])('rejects a KP-004 dependency with $name', async ({ dependency }) => {
    const version = new KnowledgePackVersion({
      packType: 'STYLE',
      packKey: 'executive-board-style',
      semanticVersion: '1.0.0',
      dependencyReferences: [dependency],
    })

    await expect(version.validate()).rejects.toThrow(/dependency/i)
  })

  test('fails closed for customer or tenant scoped packs without owning scope ids', async () => {
    const customerPack = new KnowledgePack({
      packType: 'BRAND',
      packKey: 'acme-brand',
      label: 'Acme Brand',
      purposeCategory: 'BRAND',
      visibility: 'CUSTOMER',
    })
    const tenantVersion = new KnowledgePackVersion({
      packType: 'STYLE',
      packKey: 'tenant-style',
      semanticVersion: '1.0.0',
      purposeCategory: 'STYLE',
      visibility: 'TENANT',
    })

    await expect(customerPack.validate()).rejects.toThrow(/customerId/)
    await expect(tenantVersion.validate()).rejects.toThrow(/tenantId/)
  })

  test('rejects tenant-scoped provider packs that try to store runtime truth or raw evidence metadata', async () => {
    const tenantId = objectId()
    const pack = new KnowledgePack({
      packType: 'BRAND',
      packKey: 'acme-brand',
      label: 'Acme Brand',
      purposeCategory: 'BRAND',
      visibility: 'TENANT',
      tenantId,
      sourceMetadata: {
        certifiedTruth: {
          status: 'CERTIFIED',
        },
      },
    })
    const version = new KnowledgePackVersion({
      packType: 'STYLE',
      packKey: 'acme-style',
      semanticVersion: '1.0.0',
      purposeCategory: 'STYLE',
      visibility: 'TENANT',
      tenantId,
      content: {
        rawEvidence: ['customer source extract'],
      },
    })

    await expect(pack.validate()).rejects.toThrow(/runtime truth or raw evidence/)
    await expect(version.validate()).rejects.toThrow(/runtime truth or raw evidence/)
  })
})
