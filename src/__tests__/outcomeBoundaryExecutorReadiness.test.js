import { describe, expect, test } from '@jest/globals'

import {
  KNOWLEDGE_PACK_BOUNDARIES,
} from '../constants/knowledgeRuntime.js'
import {
  buildGovernedReasoningBoundarySelection,
  buildGovernedReasoningProviderSelection,
} from '../services/governedReasoningRuntimeService.js'
import {
  buildOutcomeRenderedExpressionRlKnowledgeFacade,
} from '../services/outcomeRenderedExpressionRlExecutionService.js'

const generationPack = {
  versionId: 'kpv-generation',
  contentHash: 'sha256:generation',
  knowledgeLayer: 'OUTPUT_SCHEMA',
  executionMode: 'PROVIDER_CONTEXT',
  packType: 'OUTPUT_SCHEMA',
}

const renderingPack = {
  activationId: 'activation-rendering-layer',
  versionId: 'kpv-rendering-layer',
  contentHash: 'sha256:rendering-layer',
  knowledgeLayer: 'COMMUNICATION_PATTERN',
  executionMode: 'PROVIDER_CONTEXT',
  packType: 'RL',
  packKey: 'rendering-layer',
  stageAssignments: ['RENDERED_EXPRESSION_RL'],
  semanticVersion: '1.0.0',
  label: 'Rendering Layer',
}

const lineagePack = {
  versionId: 'kpv-lineage',
  contentHash: 'sha256:lineage',
  knowledgeLayer: 'SYSTEM',
  executionMode: 'POST_VALIDATION',
  packType: 'SYSTEM_REFERENCE',
}

describe('Outcome Studio boundary executor readiness', () => {
  test('keeps provider selection generation-only and exposes non-provider selection separately', () => {
    const binding = {
      providerContextPacks: [generationPack, renderingPack],
      postValidationPacks: [renderingPack],
      lineageCertificationPacks: [lineagePack],
    }

    expect(buildGovernedReasoningProviderSelection(binding)).toEqual([
      expect.objectContaining({ versionId: 'kpv-generation' }),
    ])
    expect(buildGovernedReasoningBoundarySelection(binding)).toEqual([
      expect.objectContaining({ versionId: 'kpv-rendering-layer' }),
      expect.objectContaining({ versionId: 'kpv-lineage' }),
    ])
  })

  test('classifies legacy RL provider metadata as post-generation validation in the stage facade', () => {
    const facade = buildOutcomeRenderedExpressionRlKnowledgeFacade({
      plan: {
        planId: 'plan-1',
        planVersion: 1,
        payload: {
          resolution: {
            policyKey: 'outcome-studio-v1',
            policyVersion: '1.0.0',
            dependencyGraph: {},
          },
        },
      },
      binding: { pack: renderingPack },
    })

    expect(facade.binding.providerContextPacks).toEqual([])
    expect(facade.binding.preValidationPacks).toEqual([])
    expect(facade.binding.postValidationPacks).toEqual([
      expect.objectContaining({
        packKey: 'rendering-layer',
        executionMode: 'PROVIDER_CONTEXT',
      }),
    ])
    expect(facade.binding.validationPacks).toEqual(facade.binding.postValidationPacks)
    expect(facade.binding.resolution.validationCount).toBe(1)
    expect(KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION).toBe('POST_GENERATION_VALIDATION')
  })
})
