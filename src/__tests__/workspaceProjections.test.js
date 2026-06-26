import { describe, expect, test } from '@jest/globals'
import {
  projectOutcomeAssetToWorkspaceAsset,
  projectOutcomeAssetVersionToWorkspaceAssetVersion,
  projectOutcomeMessageToWorkspaceMessage,
  projectOutcomeSessionToWorkspaceSession,
} from '../services/workspaceProjectionService.js'

const baseRuntimeFields = {
  runtimeInstanceId: 'a27f1f77bcf86cd799439111',
  runtimeInstanceKey: 'value-narrative-439111',
  runtimeType: 'VALUE_NARRATIVE',
  frameworkKey: 'VMF',
  packageKey: 'vmf-standard-2-3-1',
  packageVersion: '2.3.1',
  projectId: 'project-123',
  outcomeId: 'outcome-456',
  customerId: '607f1f77bcf86cd799439022',
  tenantId: '707f1f77bcf86cd799439033',
}

const truthSignature = {
  truthSignatureId: 'truth_sig_existing_fixture',
  status: 'PROJECTED',
  mode: 'PROJECTED_FROM_RUNTIME_EVIDENCE',
  persistence: 'SESSION_BOUND',
  currentness: 'CURRENT',
  boundAt: '2026-06-15T10:55:00.000Z',
  evidence: {
    lockSnapshotId: 'runtime-truth-lock-output-lab-fixture',
    graphHash: 'sha256:graph-hash',
  },
  missingEvidence: [],
  hiddenReasoning: 'raw truth reasoning must not leak',
}

const knowledgePackBinding = {
  status: 'PROJECTED',
  mode: 'REGISTRY_RESOLUTION',
  boundAt: '2026-06-15T10:55:00.000Z',
  activeCount: 1,
  requiredCount: 1,
  sourceBundle: {
    rawContent: 'raw source bundle must not leak',
  },
  activePacks: [
    {
      packCategory: 'PLATFORM',
      packType: 'TRUTH_CERTIFICATION',
      packKey: 'truth-certification-pack',
      label: 'Truth Certification',
      semanticVersion: '1.0.0',
      status: 'ACTIVE',
      scopeType: 'GLOBAL',
      scopeKey: 'GLOBAL',
      contentHash: 'sha256:truth-certification-pack',
      content: 'raw active pack content must not leak',
    },
  ],
  requiredPacks: [
    {
      packCategory: 'PLATFORM',
      packType: 'TRUTH_CERTIFICATION',
      packKey: 'truth-certification-pack',
      label: 'Truth Certification',
      status: 'ACTIVE',
      runtimeBindable: true,
      content: 'raw required pack content must not leak',
    },
  ],
}

const contextBindings = {
  workspaceContext: {
    workspaceType: 'OUTCOME',
    workspaceSessionId: 'out_sess_existing_fixture',
  },
  runtimeContext: {
    runtimeInstanceId: 'a27f1f77bcf86cd799439111',
  },
}

const expectNoRawContent = (projection) => {
  const serialized = JSON.stringify(projection)
  expect(serialized).not.toContain('raw source bundle must not leak')
  expect(serialized).not.toContain('raw active pack content must not leak')
  expect(serialized).not.toContain('raw required pack content must not leak')
  expect(serialized).not.toContain('raw persisted Markdown must not leak')
  expect(serialized).not.toContain('raw customer content must not leak')
  expect(serialized).not.toContain('raw truth reasoning must not leak')
}

describe('workspace projection service', () => {
  test('projects an OutcomeSession as a neutral WorkspaceSession', () => {
    const projection = projectOutcomeSessionToWorkspaceSession({
      _id: 'b37f1f77bcf86cd799439111',
      sessionId: 'out_sess_existing_fixture',
      status: 'ACTIVE',
      ...baseRuntimeFields,
      sourceOutputAssetId: 'out_asset_outcome_studio_fixture',
      sourceOutputTypeKey: 'EXECUTIVE_BRIEF',
      sourceOutputTypeLabel: 'Executive Brief',
      sourceOutputSnapshot: {
        markdown: 'raw persisted Markdown must not leak',
      },
      truthSignatureId: 'truth_sig_existing_fixture',
      truthSignature,
      knowledgePackBinding,
      contextBindings,
      prompt: 'raw prompt must not be projected',
      startedBy: '507f1f77bcf86cd799439012',
      startedAt: '2026-06-15T10:55:00.000Z',
      lastActivityAt: '2026-06-15T10:56:00.000Z',
    })

    expect(projection).toEqual(expect.objectContaining({
      workspaceType: 'OUTCOME',
      workspaceSessionId: 'out_sess_existing_fixture',
      runtimeInstanceId: 'a27f1f77bcf86cd799439111',
      status: 'ACTIVE',
      truthSignatureId: 'truth_sig_existing_fixture',
      promptAvailable: true,
      sourceRecord: {
        model: 'OutcomeSession',
        id: 'b37f1f77bcf86cd799439111',
        key: 'out_sess_existing_fixture',
      },
    }))
    expect(projection).not.toHaveProperty('sessionId')
    expect(projection).not.toHaveProperty('prompt')
    expect(projection.knowledgeBinding.activePacks[0]).not.toHaveProperty('content')
    expect(projection.knowledgeBinding).not.toHaveProperty('sourceBundle')
    expectNoRawContent(projection)
  })

  test('projects circular truth evidence and context bindings without throwing', () => {
    const circularEvidence = {
      lockSnapshotId: 'runtime-truth-lock-output-lab-fixture',
    }
    circularEvidence.self = circularEvidence
    const circularContext = {
      runtimeContext: {
        runtimeInstanceId: baseRuntimeFields.runtimeInstanceId,
      },
    }
    circularContext.self = circularContext

    const projection = projectOutcomeSessionToWorkspaceSession({
      _id: 'b37f1f77bcf86cd799439111',
      sessionId: 'out_sess_existing_fixture',
      status: 'ACTIVE',
      ...baseRuntimeFields,
      truthSignature: {
        ...truthSignature,
        evidence: circularEvidence,
      },
      contextBindings: circularContext,
    })

    expect(projection.truthSignature.evidence).toEqual({
      lockSnapshotId: 'runtime-truth-lock-output-lab-fixture',
    })
    expect(projection.contextBindings).toEqual({
      runtimeContext: {
        runtimeInstanceId: baseRuntimeFields.runtimeInstanceId,
      },
    })
  })

  test('projects OutcomeMessage roles into neutral workspace message types', () => {
    const userMessage = projectOutcomeMessageToWorkspaceMessage({
      _id: 'c47f1f77bcf86cd799439111',
      messageId: 'out_msg_user',
      sessionId: 'out_sess_existing_fixture',
      role: 'USER',
      status: 'SUBMITTED',
      responseStatus: 'PENDING_RESPONSE',
      ...baseRuntimeFields,
      truthSignature,
      knowledgePackBinding,
      contextBindings,
      prompt: 'raw prompt must not be projected',
    })
    const assistantMessage = projectOutcomeMessageToWorkspaceMessage({
      _id: 'c47f1f77bcf86cd799439112',
      messageId: 'out_msg_assistant',
      sessionId: 'out_sess_existing_fixture',
      role: 'ASSISTANT',
      status: 'GENERATED',
      responseStatus: 'RESPONSE_GENERATED',
      ...baseRuntimeFields,
      truthSignature,
      knowledgePackBinding,
      contextBindings,
      prompt: 'raw response text must not be projected',
    })

    expect(userMessage).toEqual(expect.objectContaining({
      workspaceType: 'OUTCOME',
      workspaceSessionId: 'out_sess_existing_fixture',
      workspaceMessageId: 'out_msg_user',
      messageType: 'CUSTOMER_PROMPT',
      promptAvailable: true,
    }))
    expect(assistantMessage).toEqual(expect.objectContaining({
      workspaceMessageId: 'out_msg_assistant',
      messageType: 'GOVERNED_RESPONSE',
    }))
    expect(userMessage).not.toHaveProperty('messageId')
    expect(userMessage).not.toHaveProperty('prompt')
    expectNoRawContent(userMessage)
    expect(JSON.stringify(assistantMessage)).not.toContain('raw response text must not be projected')
  })

  test('projects OutcomeAsset as a neutral WorkspaceAsset with default asset type', () => {
    const projection = projectOutcomeAssetToWorkspaceAsset({
      _id: 'd57f1f77bcf86cd799439111',
      outcomeAssetId: 'outcome_asset_existing_fixture',
      sessionId: 'out_sess_existing_fixture',
      status: 'GENERATED',
      ...baseRuntimeFields,
      outputTypeKey: 'EXECUTIVE_BRIEF',
      outputTypeLabel: 'Executive Brief',
      title: 'Executive Brief',
      sourceOutputAssetId: 'out_asset_outcome_studio_fixture',
      currentVersionId: 'outcome_asset_version_existing_fixture',
      currentVersionNumber: 1,
      truthSignature,
      knowledgePackBinding,
      contextBindings,
      lineageSummary: {
        sourceOutputAssetId: 'out_asset_outcome_studio_fixture',
      },
      warnings: ['Deterministic scaffold only.'],
      limitations: ['No ARL/RL execution.'],
    })

    expect(projection).toEqual(expect.objectContaining({
      workspaceType: 'OUTCOME',
      workspaceAssetId: 'outcome_asset_existing_fixture',
      workspaceSessionId: 'out_sess_existing_fixture',
      assetType: 'OUTCOME_NARRATIVE',
      currentVersionId: 'outcome_asset_version_existing_fixture',
      currentVersionNumber: 1,
      outputTypeKey: 'EXECUTIVE_BRIEF',
    }))
    expect(projection).not.toHaveProperty('outcomeAssetId')
    expectNoRawContent(projection)
  })

  test('projects OutcomeAssetVersion as a neutral WorkspaceAssetVersion without customer content', () => {
    const projection = projectOutcomeAssetVersionToWorkspaceAssetVersion({
      _id: 'e67f1f77bcf86cd799439111',
      outcomeAssetVersionId: 'outcome_asset_version_existing_fixture',
      outcomeAssetId: 'outcome_asset_existing_fixture',
      sessionId: 'out_sess_existing_fixture',
      versionNumber: 1,
      status: 'CURRENT',
      ...baseRuntimeFields,
      outputTypeKey: 'EXECUTIVE_BRIEF',
      outputTypeLabel: 'Executive Brief',
      title: 'Executive Brief',
      sourceOutputAssetId: 'out_asset_outcome_studio_fixture',
      truthSignature,
      knowledgePackBinding,
      contextBindings,
      customerContent: {
        markdown: 'raw customer content must not leak',
      },
    })

    expect(projection).toEqual(expect.objectContaining({
      workspaceType: 'OUTCOME',
      workspaceAssetId: 'outcome_asset_existing_fixture',
      workspaceAssetVersionId: 'outcome_asset_version_existing_fixture',
      workspaceSessionId: 'out_sess_existing_fixture',
      assetType: 'OUTCOME_NARRATIVE',
      versionNumber: 1,
      contentAvailable: true,
    }))
    expect(projection).not.toHaveProperty('outcomeAssetVersionId')
    expect(projection).not.toHaveProperty('customerContent')
    expectNoRawContent(projection)
  })
})
