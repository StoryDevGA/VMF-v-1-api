import { describe, expect, test } from '@jest/globals'
import mongoose from 'mongoose'
import {
  OUTCOME_STUDIO_DRAFT_ITERATION_STATUSES,
  OUTCOME_STUDIO_DRAFT_ITERATION_TYPES,
  OUTCOME_STUDIO_DRAFT_STATUSES,
} from '../constants/runtimeOutcomeStudio.js'
import {
  OutcomeDraft,
  OutcomeDraftIteration,
} from '../models/index.js'
import {
  findUnsafeOutcomeDraftPayloadKey,
} from '../models/outcomeDraftSafety.js'

const objectId = (suffix) => new mongoose.Types.ObjectId(`507f1f77bcf86cd79943${suffix}`)

const baseScope = {
  tenantId: objectId('9012'),
  customerId: objectId('9022'),
  runtimeInstanceId: objectId('9111'),
  runtimeInstanceKey: ' Value-Narrative-9111 ',
  runtimeType: ' value_narrative ',
  frameworkKey: ' vmf ',
  packageKey: 'vmf-standard-3-1-1',
  packageVersion: '3.1.1',
  projectId: ' project-123 ',
  outcomeId: '',
  sessionId: ' out_sess_oes_003a ',
  outputTypeKey: ' board_review ',
  outputTypeLabel: ' Board Review ',
  title: ' Draft Board Review ',
}

const buildDraft = (overrides = {}) => new OutcomeDraft({
  ...baseScope,
  draftId: ' draft_oes_003a ',
  sourceOutputAssetId: ' output_asset_current ',
  truthSignatureId: ' truth_sig_current ',
  truthSignature: {
    truthSignatureId: 'truth_sig_current',
    status: 'PROJECTED',
    currentness: 'CURRENT',
  },
  knowledgePackBinding: {
    status: 'PROJECTED',
    activeCount: 5,
    requiredCount: 5,
  },
  currentIterationId: ' draft_iter_1 ',
  currentIterationNumber: '1',
  contextBindings: {
    workspaceContext: {
      workspaceType: 'OUTCOME',
      workspaceSessionId: 'out_sess_oes_003a',
    },
  },
  lineageSummary: {
    grrExecutionId: 'grr_exec_1',
    grrRuntimeArtifactId: 'grr_art_1',
  },
  validationSummary: {
    status: 'PASSED',
  },
  warnings: [' Review before approval ', ''],
  limitations: [' Bound to current Certified Truth ', ''],
  createdBy: objectId('9013'),
  ...overrides,
})

const buildIteration = (overrides = {}) => new OutcomeDraftIteration({
  ...baseScope,
  draftIterationId: ' draft_iter_1 ',
  draftId: ' draft_oes_003a ',
  previousIterationId: '',
  iterationNumber: '1',
  iterationType: ' initial ',
  status: ' current ',
  sourceMessageId: ' out_msg_user_1 ',
  responseMessageId: ' out_msg_assistant_1 ',
  truthSignatureId: ' truth_sig_current ',
  grrExecutionId: ' grr_exec_1 ',
  grrRuntimeArtifactId: ' grr_art_1 ',
  customerContent: {
    markdown: '# Board Review\n\nCustomer-ready draft content.',
    sections: [
      {
        key: 'summary',
        label: 'Summary',
        body: 'Customer-ready draft content.',
      },
    ],
    metadata: {
      generationMode: 'GOVERNED_REASONING_RUNTIME',
    },
  },
  validationSummary: {
    status: 'PASSED',
  },
  lineageSummary: {
    grrExecutionId: 'grr_exec_1',
    evidenceHash: 'sha256:safe-evidence-hash',
  },
  warnings: [' Compare before approval ', ''],
  limitations: [' Runtime artefacts are not Certified Truth ', ''],
  generatedBy: objectId('9013'),
  ...overrides,
})

describe('Outcome Studio draft persistence models', () => {
  test('normalizes an OutcomeDraft as session-scoped working state', async () => {
    const draft = buildDraft({
      status: ' active ',
      approvedIterationId: ' ',
      approvedAssetVersionId: ' ',
    })

    await expect(draft.validate()).resolves.toBeUndefined()

    expect(draft.draftId).toBe('draft_oes_003a')
    expect(draft.sessionId).toBe('out_sess_oes_003a')
    expect(draft.runtimeInstanceKey).toBe('value-narrative-9111')
    expect(draft.runtimeType).toBe('VALUE_NARRATIVE')
    expect(draft.frameworkKey).toBe('VMF')
    expect(draft.outputTypeKey).toBe('BOARD_REVIEW')
    expect(draft.status).toBe(OUTCOME_STUDIO_DRAFT_STATUSES.ACTIVE)
    expect(draft.currentIterationId).toBe('draft_iter_1')
    expect(draft.currentIterationNumber).toBe(1)
    expect(draft.approvedIterationId).toBe('')
    expect(draft.approvedAssetVersionId).toBe('')
    expect(draft.warnings).toEqual(['Review before approval'])
    expect(draft.limitations).toEqual(['Bound to current Certified Truth'])
  })

  test('normalizes an OutcomeDraftIteration without creating an asset version', async () => {
    const iteration = buildIteration({
      iterationType: ' refinement ',
      status: ' superseded ',
      iterationNumber: '2',
      previousIterationId: ' draft_iter_1 ',
    })

    await expect(iteration.validate()).resolves.toBeUndefined()

    expect(iteration.draftIterationId).toBe('draft_iter_1')
    expect(iteration.draftId).toBe('draft_oes_003a')
    expect(iteration.previousIterationId).toBe('draft_iter_1')
    expect(iteration.iterationNumber).toBe(2)
    expect(iteration.iterationType).toBe(OUTCOME_STUDIO_DRAFT_ITERATION_TYPES.REFINEMENT)
    expect(iteration.status).toBe(OUTCOME_STUDIO_DRAFT_ITERATION_STATUSES.SUPERSEDED)
    expect(iteration.outputTypeKey).toBe('BOARD_REVIEW')
    expect(iteration.sourceMessageId).toBe('out_msg_user_1')
    expect(iteration.responseMessageId).toBe('out_msg_assistant_1')
    expect(iteration.grrExecutionId).toBe('grr_exec_1')
    expect(iteration.grrRuntimeArtifactId).toBe('grr_art_1')
    expect(iteration.customerContent).toEqual(expect.objectContaining({
      markdown: expect.stringContaining('Customer-ready draft content.'),
    }))
  })

  test('declares lookup indexes for drafts and draft iterations', () => {
    const draftIndexes = OutcomeDraft.schema.indexes()
    const iterationIndexes = OutcomeDraftIteration.schema.indexes()

    expect(draftIndexes).toEqual(expect.arrayContaining([
      [
        { runtimeInstanceId: 1, sessionId: 1, status: 1, updatedAt: -1 },
        expect.any(Object),
      ],
      [
        { tenantId: 1, customerId: 1, runtimeInstanceId: 1, status: 1, updatedAt: -1 },
        expect.any(Object),
      ],
      [
        { runtimeInstanceId: 1, draftId: 1 },
        expect.any(Object),
      ],
    ]))

    expect(iterationIndexes).toEqual(expect.arrayContaining([
      [
        { draftId: 1, iterationNumber: 1 },
        expect.objectContaining({ unique: true }),
      ],
      [
        { runtimeInstanceId: 1, sessionId: 1, draftId: 1, iterationNumber: -1 },
        expect.any(Object),
      ],
      [
        { runtimeInstanceId: 1, draftId: 1, status: 1, createdAt: -1 },
        expect.any(Object),
      ],
    ]))
  })

  test('rejects unsafe provider, source, evidence, and pack internals in draft payloads', async () => {
    await expect(buildDraft({
      contextBindings: {
        provider: {
          rawPrompt: 'secret provider prompt',
        },
      },
    }).validate()).rejects.toThrow(/contextBindings\.provider\.rawPrompt/)

    await expect(buildIteration({
      customerContent: {
        sections: [
          {
            key: 'summary',
            body: 'Safe body',
            rawEvidence: 'raw evidence must not be stored in draft content',
          },
        ],
      },
    }).validate()).rejects.toThrow(/customerContent\.sections\[0\]\.rawEvidence/)
  })

  test('rejects unsupported draft enum values', async () => {
    await expect(buildDraft({
      status: 'VERSION_17',
    }).validate()).rejects.toThrow(/`VERSION_17` is not a valid enum value/)

    await expect(buildIteration({
      iterationType: 'FORMAL_VERSION',
    }).validate()).rejects.toThrow(/`FORMAL_VERSION` is not a valid enum value/)
  })

  test('unsafe-key detection is circular-safe', () => {
    const payload = { safe: true }
    payload.self = payload
    payload.nested = { packContent: 'raw pack content' }

    expect(findUnsafeOutcomeDraftPayloadKey(payload, { path: 'payload' }))
      .toBe('payload.nested.packContent')
  })
})

