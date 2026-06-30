import mongoose from 'mongoose'
import { describe, test, expect } from '@jest/globals'

import FrameworkPackage from '../models/FrameworkPackage.js'
import RuntimeSkill from '../models/RuntimeSkill.js'
import KnowledgePackManifest from '../models/KnowledgePackManifest.js'
import OutcomeAsset from '../models/OutcomeAsset.js'
import OutcomeAssetVersion from '../models/OutcomeAssetVersion.js'

const objectId = () => new mongoose.Types.ObjectId()

const hasIndex = (model, expectedFields) =>
  model.schema.indexes().some(([fields]) =>
    JSON.stringify(fields) === JSON.stringify(expectedFields))

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
})
