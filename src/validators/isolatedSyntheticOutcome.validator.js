import { OUTCOME_COMMERCIAL_DECISION_LED_EXPRESSION_PROFILE_VERSION } from '../utils/outcomeDecisionLedCommercialExpressionProfile.js'
import { OUTCOME_COMMERCIAL_GOVERNED_EXPRESSION_PROFILE_VERSION } from '../utils/outcomeGovernedCommercialExpressionProfile.js'
import { OUTCOME_COMMERCIAL_READABLE_EXPRESSION_PROFILE_VERSION } from '../utils/outcomeReadableCommercialExpressionProfile.js'
import { z } from 'zod'
import { OUTCOME_COMMERCIAL_EXPRESSION_PROFILE_VERSION } from '../utils/outcomeCommercialExpressionProfile.js'
import { OUTCOME_READABLE_EXPRESSION_PROFILE_VERSION, OUTCOME_PRESENTATION_EXPRESSION_PROFILE_VERSION, OUTCOME_STRUCTURED_EXPRESSION_PROFILE_VERSION } from '../utils/outcomeRenderedExpressionRevision.js'
import { createBodyValidator, createQueryValidator, createParamsValidator } from './shared.js'
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
export const isolatedSyntheticPlanSchema = z.object({ prompt: z.string().trim().min(1).max(2000),
  continuation: z.string().max(32768).optional(), action: z.enum(['ANSWER', 'RE_RESOLVE']).optional() }).strict()
export const isolatedSyntheticConfirmSchema = z.object({ continuation: z.string().min(1).max(32768), confirm: z.literal(true) }).strict()
export const isolatedSyntheticExecuteSchema = z.object({ requestKey: uuid, requestId: uuid,
  planId: z.string().regex(/^outcome_kcp_[a-f0-9-]{36}$/), expectedPlanFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  continuation: z.object({ failedClaimEventId: uuid, failedClaimBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedResultEventId: uuid, failedResultBodyHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
  recovery: z.object({ failedClaimEventId: uuid, failedClaimBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedResultEventId: uuid, failedResultBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    executionId: z.string().regex(/^grr_exec_[a-f0-9-]{36}$/), runtimeArtifactId: z.string().regex(/^grr_art_[a-f0-9-]{36}$/),
    executionHash: z.string().regex(/^[a-f0-9]{64}$/), artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional(),
  draftRetry: z.object({ failedClaimEventId: uuid, failedClaimBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedResultEventId: uuid, failedResultBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    guidanceStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), guidanceMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedDraftStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), failedDraftMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional(),
  draftRepair: z.object({ failedClaimEventId: uuid, failedClaimBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedResultEventId: uuid, failedResultBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    guidanceStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), guidanceMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedDraftStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), failedDraftMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional(),
  handoffRecovery: z.object({ failedClaimEventId: uuid, failedClaimBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedResultEventId: uuid, failedResultBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    guidanceStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), guidanceMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedDraftStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), failedDraftMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional(),
  compositionRevision: z.object({ failedClaimEventId: uuid, failedClaimBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedResultEventId: uuid, failedResultBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    guidanceStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), guidanceMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    draftStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), draftMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedArlStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), failedArlMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional(),
  authorisedReview: z.object({ failedClaimEventId: uuid, failedClaimBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedResultEventId: uuid, failedResultBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    guidanceStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), guidanceMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    draftStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), draftMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedArlStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), failedArlMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    approvalReference: z.literal('ss044-synthetic-arl-discrepancy-followup.2026-10-22.v1'),
    approvalSha256: z.literal('c78a48f9e034d796705cb9025183cefde05331fc6970ddbe78b9cc1cde6b8432'),
    discrepancyOutcome: z.literal('DISCREPANCY'), discrepancyPackSha256: z.literal('acb1be0bcb5cc4fd5f16bd9432800ec4007251c777aec98de3ae98126d1aa2f7'),
  }).strict().optional(),
  descriptiveRepair: z.object({ failedClaimEventId: uuid, failedClaimBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedResultEventId: uuid, failedResultBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    guidanceStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), guidanceMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    draftStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), draftMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedArlStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), failedArlMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional(),
  holisticRepair: z.object({ failedClaimEventId: uuid, failedClaimBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedResultEventId: uuid, failedResultBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    guidanceStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), guidanceMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    draftStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), draftMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedArlStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), failedArlMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional(),
  referenceRepair: z.object({ failedClaimEventId: uuid, failedClaimBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedResultEventId: uuid, failedResultBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    guidanceStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), guidanceMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    draftStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), draftMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedArlStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), failedArlMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional(),
  scopingRepair: z.object({ failedClaimEventId: uuid, failedClaimBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedResultEventId: uuid, failedResultBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    guidanceStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), guidanceMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    draftStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), draftMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedArlStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), failedArlMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional(),
  metadataRepair: z.object({ failedClaimEventId: uuid, failedClaimBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedResultEventId: uuid, failedResultBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    guidanceStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), guidanceMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    draftStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), draftMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedArlStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), failedArlMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional(),
  attributionRepair: z.object({ failedClaimEventId: uuid, failedClaimBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedResultEventId: uuid, failedResultBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    guidanceStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), guidanceMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    draftStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), draftMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedArlStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), failedArlMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional(),
  wordingRepair: z.object({ failedClaimEventId: uuid, failedClaimBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedResultEventId: uuid, failedResultBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    guidanceStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), guidanceMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    draftStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), draftMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedArlStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), failedArlMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional(),
  labelRepair: z.object({ failedClaimEventId: uuid, failedClaimBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedResultEventId: uuid, failedResultBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    guidanceStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), guidanceMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    draftStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), draftMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedArlStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), failedArlMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional(),
  transportRecovery: z.object({ failedClaimEventId: uuid, failedClaimBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedResultEventId: uuid, failedResultBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    guidanceStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), guidanceMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    draftStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), draftMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedArlStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), failedArlMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional(),
  draftPersistence: z.object({ failedClaimEventId: uuid, failedClaimBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedResultEventId: uuid, failedResultBodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    guidanceStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), guidanceMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    failedDraftStageExecutionId: z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/), failedDraftMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
    executionId: z.string().regex(/^grr_exec_[a-f0-9-]{36}$/), runtimeArtifactId: z.string().regex(/^grr_art_[a-f0-9-]{36}$/),
    executionHash: z.string().regex(/^[a-f0-9]{64}$/), artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional(),
}).strict().refine(value => [value.authorisedReview, value.descriptiveRepair, value.holisticRepair, value.referenceRepair, value.scopingRepair, value.metadataRepair, value.attributionRepair, value.wordingRepair, value.labelRepair, value.transportRecovery, value.compositionRevision, value.continuation, value.recovery, value.draftRetry, value.draftRepair, value.handoffRecovery, value.draftPersistence].filter(Boolean).length <= 1, 'Only one recovery mode may be selected.')
export const validateIsolatedSyntheticScope = createQueryValidator(z.object({
  customerId: z.string().regex(/^[a-f0-9]{24}$/i), tenantId: z.string().regex(/^[a-f0-9]{24}$/i),
}).strict())
export const validateIsolatedSyntheticPlan = createBodyValidator(isolatedSyntheticPlanSchema)
export const validateIsolatedSyntheticConfirm = createBodyValidator(isolatedSyntheticConfirmSchema)
export const validateIsolatedSyntheticExecute = createBodyValidator(isolatedSyntheticExecuteSchema)
export const validateIsolatedSyntheticRequestParams = createParamsValidator(z.object({
  runtimeInstanceId: z.string().regex(/^[a-f0-9]{24}$/i), requestId: uuid,
}).strict())

const stageId = z.string().regex(/^outcome_quality_stage_[a-f0-9-]{36}$/)
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/)
export const isolatedSyntheticCompletionSourceSchema = z.object({ claimEventId: uuid, claimBodyHash: fingerprint,
  resultEventId: uuid, resultBodyHash: fingerprint, workingDraftStageExecutionId: stageId, workingDraftMaterialHash: fingerprint,
  arlStageExecutionId: stageId, arlMaterialHash: fingerprint }).strict()
export const isolatedSyntheticCompletionRecoverySchema = z.object({ claimEventId: uuid, claimBodyHash: fingerprint,
  resultEventId: uuid, resultBodyHash: fingerprint }).strict()
export const isolatedSyntheticCompletionTitleRecoverySchema = z.object({ claimEventId: uuid, claimBodyHash: fingerprint,
  resultEventId: uuid, resultBodyHash: fingerprint, narrativeStageExecutionId: stageId,
  narrativeMaterialHash: fingerprint, titleHash: fingerprint }).strict()
export const isolatedSyntheticCompletionRlPersistenceSchema = z.object({ claimEventId: uuid, claimBodyHash: fingerprint,
  resultEventId: uuid, resultBodyHash: fingerprint, shapingStageExecutionId: stageId, shapingMaterialHash: fingerprint,
  executionId: z.string().regex(/^grr_exec_[a-f0-9-]{36}$/), runtimeArtifactId: z.string().regex(/^grr_art_[a-f0-9-]{36}$/),
  executionHash: fingerprint, artifactHash: fingerprint }).strict()
export const isolatedSyntheticCompletionExpressionRepairSchema = z.object({ claimEventId: uuid, claimBodyHash: fingerprint,
  resultEventId: uuid, resultBodyHash: fingerprint, narrativeStageExecutionId: stageId, narrativeMaterialHash: fingerprint,
  shapingStageExecutionId: stageId, shapingMaterialHash: fingerprint, failedRlStageExecutionId: stageId, failedRlMaterialHash: fingerprint,
  executionId: z.string().regex(/^grr_exec_[a-f0-9-]{36}$/), runtimeArtifactId: z.string().regex(/^grr_art_[a-f0-9-]{36}$/),
  executionHash: fingerprint, artifactHash: fingerprint, expressionProfileVersion: z.literal(OUTCOME_READABLE_EXPRESSION_PROFILE_VERSION) }).strict()
export const isolatedSyntheticCompletionExpressionFollowupSchema = isolatedSyntheticCompletionExpressionRepairSchema
  .omit({ expressionProfileVersion: true }).extend({ expressionProfileVersion: z.literal(OUTCOME_PRESENTATION_EXPRESSION_PROFILE_VERSION),
    reviewedOutputFingerprint: fingerprint }).strict()
export const isolatedSyntheticCompletionExpressionFaithfulSchema = isolatedSyntheticCompletionExpressionFollowupSchema
  .omit({ expressionProfileVersion: true }).extend({ expressionProfileVersion: z.literal(OUTCOME_STRUCTURED_EXPRESSION_PROFILE_VERSION) }).strict()
export const isolatedSyntheticCompletionExpressionContractSchema = isolatedSyntheticCompletionExpressionFaithfulSchema
  .omit({ expressionProfileVersion: true }).extend({ expressionProfileVersion: z.literal(OUTCOME_COMMERCIAL_EXPRESSION_PROFILE_VERSION) }).strict()
export const isolatedSyntheticCompletionExpressionReadableSchema = isolatedSyntheticCompletionExpressionContractSchema
  .omit({ expressionProfileVersion: true }).extend({ expressionProfileVersion: z.literal(OUTCOME_COMMERCIAL_READABLE_EXPRESSION_PROFILE_VERSION) }).strict()
export const isolatedSyntheticCompletionExpressionOverlaySchema = isolatedSyntheticCompletionExpressionReadableSchema
  .omit({ expressionProfileVersion: true }).extend({ expressionProfileVersion: z.literal(OUTCOME_COMMERCIAL_GOVERNED_EXPRESSION_PROFILE_VERSION) }).strict()
export const isolatedSyntheticCompletionExpressionPresentationSchema = isolatedSyntheticCompletionExpressionOverlaySchema
  .omit({ expressionProfileVersion: true }).extend({ expressionProfileVersion: z.literal(OUTCOME_COMMERCIAL_DECISION_LED_EXPRESSION_PROFILE_VERSION) }).strict()
export const isolatedSyntheticCompleteSchema = z.object({ requestKey: uuid, requestId: uuid,
  planId: z.string().regex(/^outcome_kcp_[a-f0-9-]{36}$/), expectedPlanFingerprint: fingerprint,
  completionSource: isolatedSyntheticCompletionSourceSchema, referenceRecovery: isolatedSyntheticCompletionRecoverySchema.optional(),
  titleRecovery: isolatedSyntheticCompletionTitleRecoverySchema.optional(),
  rlPersistenceRecovery: isolatedSyntheticCompletionRlPersistenceSchema.optional(),
  expressionRepair: isolatedSyntheticCompletionExpressionRepairSchema.optional(),
  expressionFollowup: isolatedSyntheticCompletionExpressionFollowupSchema.optional(),
  expressionFaithful: isolatedSyntheticCompletionExpressionFaithfulSchema.optional(),
  expressionReadable: isolatedSyntheticCompletionExpressionReadableSchema.optional(),
  expressionPresentation: isolatedSyntheticCompletionExpressionPresentationSchema.optional(),
  expressionOverlay: isolatedSyntheticCompletionExpressionOverlaySchema.optional(),
  expressionContract: isolatedSyntheticCompletionExpressionContractSchema.optional() }).strict()
  .refine(value => !value.titleRecovery || Boolean(value.referenceRecovery), 'Title recovery requires reference recovery.')
  .refine(value => !value.titleRecovery || new Set([value.completionSource.claimEventId, value.completionSource.resultEventId,
    value.referenceRecovery?.claimEventId, value.referenceRecovery?.resultEventId,
    value.titleRecovery.claimEventId, value.titleRecovery.resultEventId]).size === 6, 'Recovery parent event identities must be distinct.')
  .refine(value => !value.rlPersistenceRecovery || Boolean(value.titleRecovery) && new Set([value.completionSource.claimEventId,
    value.completionSource.resultEventId, value.referenceRecovery?.claimEventId, value.referenceRecovery?.resultEventId,
    value.titleRecovery?.claimEventId, value.titleRecovery?.resultEventId, value.rlPersistenceRecovery.claimEventId,
    value.rlPersistenceRecovery.resultEventId]).size === 8, 'RL persistence recovery requires distinct title recovery parents.')
  .refine(value => !value.expressionRepair || Boolean(value.rlPersistenceRecovery) && new Set([value.completionSource.claimEventId,
    value.completionSource.resultEventId, value.referenceRecovery?.claimEventId, value.referenceRecovery?.resultEventId,
    value.titleRecovery?.claimEventId, value.titleRecovery?.resultEventId, value.rlPersistenceRecovery?.claimEventId,
    value.rlPersistenceRecovery?.resultEventId, value.expressionRepair.claimEventId, value.expressionRepair.resultEventId]).size === 10,
  'Expression repair requires distinct persistence recovery parents.')
  .refine(value => !value.expressionFollowup || Boolean(value.expressionRepair) && new Set([value.completionSource.claimEventId,
    value.completionSource.resultEventId, value.referenceRecovery?.claimEventId, value.referenceRecovery?.resultEventId,
    value.titleRecovery?.claimEventId, value.titleRecovery?.resultEventId, value.rlPersistenceRecovery?.claimEventId,
    value.rlPersistenceRecovery?.resultEventId, value.expressionRepair?.claimEventId, value.expressionRepair?.resultEventId,
    value.expressionFollowup.claimEventId, value.expressionFollowup.resultEventId]).size === 12,
  'Expression follow-up requires distinct expression repair parents.')
  .refine(value => !value.expressionFaithful || Boolean(value.expressionFollowup) && new Set([value.completionSource.claimEventId,
    value.completionSource.resultEventId, value.referenceRecovery?.claimEventId, value.referenceRecovery?.resultEventId,
    value.titleRecovery?.claimEventId, value.titleRecovery?.resultEventId, value.rlPersistenceRecovery?.claimEventId,
    value.rlPersistenceRecovery?.resultEventId, value.expressionRepair?.claimEventId, value.expressionRepair?.resultEventId,
    value.expressionFollowup?.claimEventId, value.expressionFollowup?.resultEventId,
    value.expressionFaithful.claimEventId, value.expressionFaithful.resultEventId]).size === 14,
  'Faithful expression requires distinct expression follow-up parents.')
  .refine(value => !value.expressionContract || Boolean(value.expressionFaithful) && new Set([value.completionSource.claimEventId,
    value.completionSource.resultEventId, value.referenceRecovery?.claimEventId, value.referenceRecovery?.resultEventId,
    value.titleRecovery?.claimEventId, value.titleRecovery?.resultEventId, value.rlPersistenceRecovery?.claimEventId,
    value.rlPersistenceRecovery?.resultEventId, value.expressionRepair?.claimEventId, value.expressionRepair?.resultEventId,
    value.expressionFollowup?.claimEventId, value.expressionFollowup?.resultEventId,
    value.expressionFaithful?.claimEventId, value.expressionFaithful?.resultEventId,
    value.expressionContract.claimEventId, value.expressionContract.resultEventId]).size === 16,
  'Contract expression requires distinct faithful expression parents.')
  .refine(value => !value.expressionReadable || Boolean(value.expressionContract) && new Set([value.completionSource.claimEventId,
    value.completionSource.resultEventId, value.referenceRecovery?.claimEventId, value.referenceRecovery?.resultEventId,
    value.titleRecovery?.claimEventId, value.titleRecovery?.resultEventId, value.rlPersistenceRecovery?.claimEventId,
    value.rlPersistenceRecovery?.resultEventId, value.expressionRepair?.claimEventId, value.expressionRepair?.resultEventId,
    value.expressionFollowup?.claimEventId, value.expressionFollowup?.resultEventId,
    value.expressionFaithful?.claimEventId, value.expressionFaithful?.resultEventId,
    value.expressionContract?.claimEventId, value.expressionContract?.resultEventId,
    value.expressionReadable.claimEventId, value.expressionReadable.resultEventId]).size === 18,
  'Readable expression requires distinct contract expression parents.')
  .refine(value => !value.expressionOverlay || Boolean(value.expressionReadable) && new Set([value.completionSource.claimEventId,
    value.completionSource.resultEventId, value.referenceRecovery?.claimEventId, value.referenceRecovery?.resultEventId,
    value.titleRecovery?.claimEventId, value.titleRecovery?.resultEventId, value.rlPersistenceRecovery?.claimEventId,
    value.rlPersistenceRecovery?.resultEventId, value.expressionRepair?.claimEventId, value.expressionRepair?.resultEventId,
    value.expressionFollowup?.claimEventId, value.expressionFollowup?.resultEventId,
    value.expressionFaithful?.claimEventId, value.expressionFaithful?.resultEventId,
    value.expressionContract?.claimEventId, value.expressionContract?.resultEventId,
    value.expressionReadable?.claimEventId, value.expressionReadable?.resultEventId,
    value.expressionOverlay.claimEventId, value.expressionOverlay.resultEventId]).size === 20,
  'Governed overlay requires distinct readable expression parents.')
  .refine(value => !value.expressionPresentation || Boolean(value.expressionOverlay) && new Set([value.completionSource.claimEventId,
    value.completionSource.resultEventId, value.referenceRecovery?.claimEventId, value.referenceRecovery?.resultEventId,
    value.titleRecovery?.claimEventId, value.titleRecovery?.resultEventId, value.rlPersistenceRecovery?.claimEventId,
    value.rlPersistenceRecovery?.resultEventId, value.expressionRepair?.claimEventId, value.expressionRepair?.resultEventId,
    value.expressionFollowup?.claimEventId, value.expressionFollowup?.resultEventId,
    value.expressionFaithful?.claimEventId, value.expressionFaithful?.resultEventId,
    value.expressionContract?.claimEventId, value.expressionContract?.resultEventId,
    value.expressionReadable?.claimEventId, value.expressionReadable?.resultEventId,
    value.expressionOverlay?.claimEventId, value.expressionOverlay?.resultEventId,
    value.expressionPresentation.claimEventId, value.expressionPresentation.resultEventId]).size === 22,
  'Decision-led presentation requires distinct governed overlay parents.')
export const validateIsolatedSyntheticComplete = createBodyValidator(isolatedSyntheticCompleteSchema)
