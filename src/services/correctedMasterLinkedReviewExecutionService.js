import { createGenuineMasterLinkedReviewAuthority } from './masterLinkedGenuineReviewAuthorityService.js'
import { createNetworkQaMasterLinkedReviewAuthority } from './masterLinkedGenuineReviewAuthorityService.js'
import { createOpenAiMasterLinkedDocxReviewProviderAdapter } from './openAiMasterLinkedDocxReviewProviderAdapter.js'
import { createOpenAiMasterLinkedCategoryDocxReviewProviderAdapter } from './openAiMasterLinkedDocxReviewProviderAdapter.js'
import { createOpenAiApprovedMasterLinkedDocxReviewProviderAdapter } from './openAiMasterLinkedDocxReviewProviderAdapter.js'
import { createApprovedGenuineMasterLinkedReviewAuthority } from './masterLinkedGenuineReviewAuthorityService.js'
import { createApprovedGenuineMasterLinkedCompletedReviewStore } from './masterLinkedCompletedReviewService.js'
import { createApprovedNetworkQaMasterLinkedReviewAuthority } from './masterLinkedGenuineReviewAuthorityService.js'
import { createApprovedNetworkQaMasterLinkedCompletedReviewStore } from './masterLinkedCompletedReviewService.js'
import { createFakeNetworkApprovedMasterLinkedDocxReviewProviderAdapter } from './openAiMasterLinkedDocxReviewProviderAdapter.js'
import { createGenuineMasterLinkedCompletedReviewStore } from './masterLinkedCompletedReviewService.js'
import { createNetworkQaMasterLinkedCompletedReviewStore } from './masterLinkedCompletedReviewService.js'
import { createFakeNetworkMasterLinkedCategoryReviewProviderAdapter } from './openAiMasterLinkedDocxReviewProviderAdapter.js'
import { G1_CATEGORY_QA_RELEASE, isG1CategoryQaRequest } from './masterLinkedGenuineReviewContract.js'
import { G1_FIXED, G1_CORRECTED_GENUINE_RELEASE, g1Need as need } from './masterLinkedGenuineReviewContract.js'
import { G1_APPROVED_GENUINE_RELEASE, isG1ApprovedRequest } from './masterLinkedGenuineReviewContract.js'
import { G1_NARROW_GENUINE_RELEASE, isG1NarrowRequest } from './masterLinkedGenuineReviewContract.js'
import { createNarrowGenuineMasterLinkedReviewAuthority } from './masterLinkedGenuineReviewAuthorityService.js'
import { createNarrowGenuineMasterLinkedCompletedReviewStore } from './masterLinkedCompletedReviewService.js'
import { createOpenAiNarrowMasterLinkedDocxReviewProviderAdapter } from './openAiMasterLinkedDocxReviewProviderAdapter.js'
import { simulationExact as exact } from './masterLinkedReviewSimulationContract.js'

// Internal worker entry point. Calling it requires a separately issued native
// corrected release; implementation or QA evidence is never that authority.
export const executeCorrectedMasterLinkedReview = async args => {
  need(!isG1CategoryQaRequest(args?.expected), 'CATEGORY_EXECUTOR_REQUIRED')
  need(exact(args, ['actorUserId', 'runtimeInstanceId', 'candidateId', 'scopes', 'expected', 'approvalAuditId'])
    && args.actorUserId === G1_FIXED.actorUserId && args.runtimeInstanceId === G1_FIXED.runtimeInstanceId
    && args.candidateId === G1_CORRECTED_GENUINE_RELEASE.candidateId, 'CORRECTED_EXECUTION_INPUT')
  const input = JSON.parse(JSON.stringify(args)), store = createGenuineMasterLinkedCompletedReviewStore()
  await store.assertIndexes()
  const prepared = await createGenuineMasterLinkedReviewAuthority().prepare(input)
  const read = { actorUserId: input.actorUserId, scopes: input.scopes, grantExecutionId: prepared.grant.body.executionId }
  if (prepared.state !== 'FRESH_RESERVATION') return store.reconcile(read)
  const providerResult = await createOpenAiMasterLinkedDocxReviewProviderAdapter()(prepared.capability)
  // A valid quality FAIL is evidence too. Persist it once, then stop; neither
  // this path nor replay creates approval, finalisation or another submission.
  return store.persist({ actorUserId: input.actorUserId, scopes: input.scopes, providerResult })
}

// Separate versioned genuine path. Implementation grants no release: the
// default authority must verify a new signed native permission before start.
export const executeCategoryGenuineMasterLinkedReview = async args => {
  need(exact(args, ['actorUserId', 'runtimeInstanceId', 'candidateId', 'scopes', 'expected', 'approvalAuditId'])
    && args.actorUserId === G1_FIXED.actorUserId && args.runtimeInstanceId === G1_FIXED.runtimeInstanceId
    && args.candidateId === G1_CATEGORY_QA_RELEASE.candidateId && isG1CategoryQaRequest(args.expected), 'CATEGORY_GENUINE_EXECUTION_INPUT')
  const input = JSON.parse(JSON.stringify(args)), store = createGenuineMasterLinkedCompletedReviewStore()
  await store.assertIndexes()
  const prepared = await createGenuineMasterLinkedReviewAuthority().prepare(input)
  const read = { actorUserId: input.actorUserId, scopes: input.scopes, grantExecutionId: prepared.grant.body.executionId }
  if (prepared.state !== 'FRESH_RESERVATION') return store.reconcile(read)
  const providerResult = await createOpenAiMasterLinkedCategoryDocxReviewProviderAdapter()(prepared.capability)
  return store.persist({ actorUserId: input.actorUserId, scopes: input.scopes, providerResult })
}

// The approved wording decision is source compatibility, never permission to
// submit. This path still requires its own signed, exact one-use release.
export const executeApprovedGenuineMasterLinkedReview = async args => {
  need(exact(args, ['actorUserId', 'runtimeInstanceId', 'candidateId', 'scopes', 'expected', 'approvalAuditId'])
    && args.actorUserId === G1_FIXED.actorUserId && args.runtimeInstanceId === G1_FIXED.runtimeInstanceId
    && args.candidateId === G1_APPROVED_GENUINE_RELEASE.candidateId && isG1ApprovedRequest(args.expected), 'APPROVED_GENUINE_EXECUTION_INPUT')
  const input = JSON.parse(JSON.stringify(args)), store = createApprovedGenuineMasterLinkedCompletedReviewStore()
  await store.assertIndexes()
  const prepared = await createApprovedGenuineMasterLinkedReviewAuthority().prepare(input)
  const read = { actorUserId: input.actorUserId, scopes: input.scopes, grantExecutionId: prepared.grant.body.executionId }
  if (prepared.state !== 'FRESH_RESERVATION') return store.reconcile(read)
  const providerResult = await createOpenAiApprovedMasterLinkedDocxReviewProviderAdapter()(prepared.capability)
  return store.persist({ actorUserId: input.actorUserId, scopes: input.scopes, providerResult })
}

// Exact private narrow correction only; its new implementation is not release.
export const executeNarrowGenuineMasterLinkedReview = async args => {
  need(exact(args, ['actorUserId', 'runtimeInstanceId', 'candidateId', 'scopes', 'expected', 'approvalAuditId'])
    && args.actorUserId === G1_FIXED.actorUserId && args.runtimeInstanceId === G1_FIXED.runtimeInstanceId
    && args.candidateId === G1_NARROW_GENUINE_RELEASE.candidateId && isG1NarrowRequest(args.expected), 'NARROW_GENUINE_EXECUTION_INPUT')
  const input = JSON.parse(JSON.stringify(args)), store = createNarrowGenuineMasterLinkedCompletedReviewStore()
  await store.assertIndexes()
  const prepared = await createNarrowGenuineMasterLinkedReviewAuthority().prepare(input)
  const read = { actorUserId: input.actorUserId, scopes: input.scopes, grantExecutionId: prepared.grant.body.executionId }
  if (prepared.state !== 'FRESH_RESERVATION') return store.reconcile(read)
  const providerResult = await createOpenAiNarrowMasterLinkedDocxReviewProviderAdapter()(prepared.capability)
  return store.persist({ actorUserId: input.actorUserId, scopes: input.scopes, providerResult })
}

// Synthetic provider transport only; native authority and persisted source/store
// owners remain real. Its separate QA root can never consume genuine release.
export const executeApprovedNetworkQaMasterLinkedReview = async (args, fetchImpl) => {
  need(exact(args, ['actorUserId', 'runtimeInstanceId', 'candidateId', 'scopes', 'expected', 'qaCase', 'qaReleaseAuditId'])
    && args.actorUserId === G1_FIXED.actorUserId && args.runtimeInstanceId === G1_FIXED.runtimeInstanceId
    && args.candidateId === G1_APPROVED_GENUINE_RELEASE.candidateId && isG1ApprovedRequest(args.expected)
    && typeof fetchImpl === 'function', 'APPROVED_QA_EXECUTION_INPUT')
  const input = JSON.parse(JSON.stringify(args)), store = createApprovedNetworkQaMasterLinkedCompletedReviewStore()
  await store.assertIndexes()
  const prepared = await createApprovedNetworkQaMasterLinkedReviewAuthority().prepare(input)
  const read = { actorUserId: input.actorUserId, scopes: input.scopes, grantExecutionId: prepared.grant.body.executionId }
  if (prepared.state !== 'FRESH_RESERVATION') return store.reconcile(read)
  const providerResult = await createFakeNetworkApprovedMasterLinkedDocxReviewProviderAdapter({ fetchImpl })(prepared.capability)
  return store.persist({ actorUserId: input.actorUserId, scopes: input.scopes, providerResult })
}

// Separate QA-only path. The caller supplies a fake transport, never source,
// permission or storage replacements. No genuine counterpart is released.
export const executeCategoryNetworkQaMasterLinkedReview = async (args, fetchImpl) => {
  need(exact(args, ['actorUserId', 'runtimeInstanceId', 'candidateId', 'scopes', 'expected', 'qaCase', 'qaReleaseAuditId'])
    && args.actorUserId === G1_FIXED.actorUserId && args.runtimeInstanceId === G1_FIXED.runtimeInstanceId
    && args.candidateId === G1_CATEGORY_QA_RELEASE.candidateId && isG1CategoryQaRequest(args.expected)
    && typeof fetchImpl === 'function', 'CATEGORY_QA_EXECUTION_INPUT')
  const input = JSON.parse(JSON.stringify(args)), store = createNetworkQaMasterLinkedCompletedReviewStore()
  await store.assertIndexes()
  const prepared = await createNetworkQaMasterLinkedReviewAuthority().prepare(input)
  const read = { actorUserId: input.actorUserId, scopes: input.scopes, grantExecutionId: prepared.grant.body.executionId }
  if (prepared.state !== 'FRESH_RESERVATION') return store.reconcile(read)
  const providerResult = await createFakeNetworkMasterLinkedCategoryReviewProviderAdapter({ fetchImpl })(prepared.capability)
  return store.persist({ actorUserId: input.actorUserId, scopes: input.scopes, providerResult })
}
