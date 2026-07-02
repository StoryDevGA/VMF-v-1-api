import { describe, test, expect } from '@jest/globals'

import KnowledgePackManifest, {
  buildKnowledgePackManifestId,
} from '../models/KnowledgePackManifest.js'

describe('KnowledgePackManifest model', () => {
  test('normalizes manifest identity, scope, and pack references', async () => {
    const manifest = new KnowledgePackManifest({
      manifestKey: ' Outcome-Studio-Default ',
      manifestName: ' Outcome Studio Default Knowledge Manifest ',
      manifestType: 'outcome_studio_default',
      semanticVersion: '1.0.0',
      status: 'active',
      workspaceType: 'outcome',
      frameworkKey: ' vmf ',
      runtimeType: ' value_narrative ',
      packageKey: ' Standard-Package-VMF-3-1-RKM ',
      scopeType: 'package',
      scopeKey: ' package:vmf:standard-package-vmf-3-1-rkm:3.1 ',
      mandatoryPacks: [
        {
          packCategory: 'platform',
          purposeCategory: 'governance',
          packType: 'truth_certification',
          packKey: ' Truth-Certification-Pack ',
          label: ' Truth Certification ',
          executionMode: 'provider_context',
          dependencyKeys: [' ARL ', 'arl', ''],
        },
      ],
      validationPacks: [
        {
          packCategory: 'platform',
          purposeCategory: 'validation',
          packType: 'truth_certification',
          packKey: ' Truth-Validation-Pack ',
          label: ' Truth Validation ',
          executionMode: 'post_validation',
          dependencyKeys: [' TRUTH-CERTIFICATION-PACK '],
        },
      ],
    })

    await expect(manifest.validate()).resolves.toBeUndefined()
    expect(manifest.manifestId).toBe('kpm-outcome-studio-default-1-0-0-package-vmf-standard-package-vmf-3-1-rkm-3-1')
    expect(manifest.manifestKey).toBe('outcome-studio-default')
    expect(manifest.manifestType).toBe('OUTCOME_STUDIO_DEFAULT')
    expect(manifest.status).toBe('ACTIVE')
    expect(manifest.workspaceType).toBe('OUTCOME')
    expect(manifest.frameworkKey).toBe('VMF')
    expect(manifest.runtimeType).toBe('VALUE_NARRATIVE')
    expect(manifest.packageKey).toBe('standard-package-vmf-3-1-rkm')
    expect(manifest.scopeType).toBe('PACKAGE')
    expect(manifest.scopeKey).toBe('PACKAGE:VMF:STANDARD-PACKAGE-VMF-3-1-RKM:3.1')
    expect(manifest.mandatoryPacks[0]).toEqual(expect.objectContaining({
      packCategory: 'PLATFORM',
      purposeCategory: 'GOVERNANCE',
      packType: 'TRUTH_CERTIFICATION',
      packKey: 'truth-certification-pack',
      executionMode: 'PROVIDER_CONTEXT',
      dependencyKeys: ['arl'],
    }))
    expect(manifest.validationPacks[0]).toEqual(expect.objectContaining({
      packCategory: 'PLATFORM',
      purposeCategory: 'VALIDATION',
      packType: 'TRUTH_CERTIFICATION',
      packKey: 'truth-validation-pack',
      executionMode: 'POST_VALIDATION',
      dependencyKeys: ['truth-certification-pack'],
    }))
  })

  test('rejects unsupported execution modes inside manifest pack references', async () => {
    const manifest = new KnowledgePackManifest({
      manifestKey: 'invalid-execution-mode',
      manifestName: 'Invalid Execution Mode',
      semanticVersion: '1.0.0',
      mandatoryPacks: [
        {
          purposeCategory: 'GOVERNANCE',
          packType: 'ARL',
          packKey: 'adaptive-reasoning-layer',
          executionMode: 'LOAD_EVERYTHING',
        },
      ],
    })

    await expect(manifest.validate()).rejects.toThrow(/executionMode/)
  })

  test('buildKnowledgePackManifestId creates stable safe ids', () => {
    expect(buildKnowledgePackManifestId({
      manifestKey: 'Outcome Studio Default',
      semanticVersion: '1.0.0',
      scopeKey: 'GLOBAL',
    })).toBe('kpm-outcome-studio-default-1-0-0-global')
  })
})
