import { createHash } from 'node:crypto'

const id = (value) => String(value ?? '').trim()
const canonical = (value) => {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (value?.toHexString) return value.toHexString()
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])]))
  return value
}
export const hashOutcomeSuccessorValue = (value) => createHash('sha256')
  .update(JSON.stringify(canonical(value))).digest('hex')

export const outcomeSuccessorError = (reason, status = 409) => Object.assign(
  new Error(reason === 'OUTCOME_SUCCESSOR_MATERIAL_LINEAGE_CHANGE'
    ? 'The Framework or package lineage changed. Create a new asset instead.'
    : 'The governed successor boundary could not be verified.'),
  { status, statusCode: status, code: 'OUTCOME_SUCCESSOR_BLOCKED', reason, details: { reason } },
)
const requireValue = (value, reason) => {
  if (!id(value)) throw outcomeSuccessorError(reason)
  return id(value)
}
const optionalWorkspaceId = (value) => {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string') throw outcomeSuccessorError('OUTCOME_SUCCESSOR_SCOPE_INCOMPLETE')
  return value.trim()
}

export const outcomeSuccessorRuntimeIdentity = (runtime) => {
  const runtimeInstanceId = requireValue(runtime?._id || runtime?.id, 'OUTCOME_SUCCESSOR_RUNTIME_LINEAGE_INCOMPLETE')
  const revisionNumber = Number(runtime.revision?.revisionNumber)
  if (!Number.isSafeInteger(revisionNumber) || revisionNumber < 1
    || (revisionNumber === 1 && (runtime.revision?.parentRuntimeId
      || (runtime.revision?.rootRuntimeId && id(runtime.revision.rootRuntimeId) !== runtimeInstanceId)))
    || (revisionNumber > 1 && (!runtime.revision?.rootRuntimeId || !runtime.revision?.parentRuntimeId))) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_RUNTIME_LINEAGE_INCOMPLETE')
  }
  return {
    runtimeInstanceId, runtimeInstanceKey: id(runtime.runtimeInstanceKey), revisionNumber,
    rootRuntimeId: id(runtime.revision?.rootRuntimeId) || runtimeInstanceId,
    stateVersion: requireValue(runtime.stateVersion, 'OUTCOME_SUCCESSOR_RUNTIME_LINEAGE_INCOMPLETE'),
    customerId: requireValue(runtime.customerId, 'OUTCOME_SUCCESSOR_SCOPE_INCOMPLETE'),
    tenantId: requireValue(runtime.tenantId, 'OUTCOME_SUCCESSOR_SCOPE_INCOMPLETE'),
    workspaceId: optionalWorkspaceId(runtime.workspaceId),
    runtimeType: requireValue(runtime.runtimeType, 'OUTCOME_SUCCESSOR_RUNTIME_LINEAGE_INCOMPLETE'),
    frameworkKey: requireValue(runtime.frameworkKey, 'OUTCOME_SUCCESSOR_RUNTIME_LINEAGE_INCOMPLETE'),
    packageId: requireValue(runtime.packageId, 'OUTCOME_SUCCESSOR_RUNTIME_LINEAGE_INCOMPLETE'),
    packageKey: requireValue(runtime.packageKey, 'OUTCOME_SUCCESSOR_RUNTIME_LINEAGE_INCOMPLETE'),
    packageVersion: requireValue(runtime.packageVersion, 'OUTCOME_SUCCESSOR_RUNTIME_LINEAGE_INCOMPLETE'),
    dependencySnapshotId: requireValue(runtime.evidence?.dependencySnapshotId, 'OUTCOME_SUCCESSOR_RUNTIME_LINEAGE_INCOMPLETE'),
    dependencySnapshotHash: requireValue(runtime.evidence?.dependencySnapshotHash, 'OUTCOME_SUCCESSOR_RUNTIME_LINEAGE_INCOMPLETE'),
  }
}

export const assertOutcomeSuccessorTarget = ({ sourceRuntime, targetRuntime }) => {
  const source = outcomeSuccessorRuntimeIdentity(sourceRuntime)
  const target = outcomeSuccessorRuntimeIdentity(targetRuntime)
  if (['customerId', 'tenantId', 'workspaceId'].some((field) => source[field] !== target[field])) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_SCOPE_MISMATCH', 403)
  }
  if (['runtimeType', 'frameworkKey', 'packageId', 'packageKey', 'packageVersion',
    'dependencySnapshotId', 'dependencySnapshotHash'].some((field) => source[field] !== target[field])) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_MATERIAL_LINEAGE_CHANGE')
  }
  if (source.runtimeInstanceId !== target.runtimeInstanceId
    && (source.rootRuntimeId !== target.rootRuntimeId || target.revisionNumber <= source.revisionNumber)) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_TARGET_NOT_NEWER_SAME_LINEAGE')
  }
  if (targetRuntime.status !== 'LOCKED') throw outcomeSuccessorError('OUTCOME_SUCCESSOR_TARGET_NOT_LOCKED')
  return { source, target }
}

export const assertOutcomeSuccessorSource = ({ sourceRuntime, asset, version, session, plan, draft, iteration }) => {
  const source = outcomeSuccessorRuntimeIdentity(sourceRuntime)
  if (!asset || !version || !session || !plan || !draft || !iteration) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_SOURCE_LINEAGE_INCOMPLETE')
  }
  for (const record of [asset, version, session, plan, draft, iteration]) {
    if (['customerId', 'tenantId'].some((field) => id(record[field]) !== source[field])
      || id(record.runtimeInstanceId) !== source.runtimeInstanceId) {
      throw outcomeSuccessorError('OUTCOME_SUCCESSOR_SCOPE_MISMATCH', 403)
    }
  }
  const approval = version.lineageSummary?.draftApproval
  if (!['GENERATED', 'PUBLISHED'].includes(asset.status)
    || !['CURRENT', 'SUPERSEDED'].includes(version.status)
    || !approval || approval.operation !== 'DRAFT_APPROVAL'
    || id(approval.outcomeAssetId) !== id(asset.outcomeAssetId)
    || id(approval.outcomeAssetVersionId) !== id(version.outcomeAssetVersionId)
    || id(version.outcomeAssetId) !== id(asset.outcomeAssetId)
    || id(approval.draftId) !== id(draft.draftId)
    || id(approval.draftIterationId) !== id(iteration.draftIterationId)
    || id(iteration.draftId) !== id(draft.draftId)
    || draft.status !== 'APPROVED'
    || id(draft.approvedIterationId) !== id(iteration.draftIterationId)
    || id(draft.approvedAssetVersionId) !== id(version.outcomeAssetVersionId)
    || !Number.isSafeInteger(version.versionNumber) || version.versionNumber < 1
    || approval.versionNumber !== version.versionNumber
    || !Number.isSafeInteger(iteration.iterationNumber) || iteration.iterationNumber < 1
    || approval.draftIterationNumber !== iteration.iterationNumber
    || iteration.status !== 'APPROVED'
    || !id(approval.approvedBy) || !id(approval.approvedAt)) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_SOURCE_NOT_APPROVED')
  }
  const requestPlan = session.contextBindings?.requestPlan
  if (!requestPlan || id(requestPlan.requestId) !== id(plan.requestId)
    || id(requestPlan.planId) !== id(plan.planId)
    || requestPlan.planFingerprint !== plan.planFingerprint
    || [version, draft, iteration].some((record) => id(record.sessionId) !== id(session.sessionId))) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_SOURCE_LINEAGE_INCOMPLETE')
  }
  if (['frameworkKey', 'packageKey', 'packageVersion'].some((field) => id(version[field]) !== source[field])) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_MATERIAL_LINEAGE_CHANGE')
  }
  const intent = plan.payload?.consumerIntent
  const context = plan.payload?.governedContext
  if (!intent?.originalRequest || !intent.requestedOutputTypeKey || !intent.outcome
    || !intent.decisionPurpose || !intent.consumer || !intent.audience?.length || !intent.format
    || !context?.outputType?.key || !context.outputSchema?.key || !context.style?.key) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_SOURCE_CONTRACT_INCOMPLETE')
  }
  frozenContractPacks(plan)
  return {
    source, sourceAssetId: id(asset.outcomeAssetId), sourceAssetVersionId: id(version.outcomeAssetVersionId),
    sourceVersionNumber: version.versionNumber,
    sourceVersionWitnessHash: hashOutcomeSuccessorValue(version),
    sourceHash: hashOutcomeSuccessorValue({ runtimeInstanceId: version.runtimeInstanceId,
      outcomeAssetId: version.outcomeAssetId, outcomeAssetVersionId: version.outcomeAssetVersionId,
      customerContent: version.customerContent, lineageSummary: version.lineageSummary,
      contextBindings: version.contextBindings, renderingProfile: version.renderingProfile,
      truthSignature: version.truthSignature, knowledgePackBinding: version.knowledgePackBinding }),
    intent: canonical(intent), outputContract: canonical(context),
    intentFingerprint: hashOutcomeSuccessorValue(intent), contractFingerprint: hashOutcomeSuccessorValue(context),
  }
}

export const assertOutcomeSuccessorCarryForward = ({ sourcePlan, candidate }) => {
  if (hashOutcomeSuccessorValue(sourcePlan.payload.consumerIntent)
    !== hashOutcomeSuccessorValue(candidate.payload?.consumerIntent)) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_INTENT_CHANGED')
  }
  const binding = (plan) => {
    const context = plan.payload?.governedContext
    return { outputType: context?.outputType, outputSchema: context?.outputSchema, style: context?.style }
  }
  if (hashOutcomeSuccessorValue(binding(sourcePlan)) !== hashOutcomeSuccessorValue(binding(candidate))) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_OUTPUT_CONTRACT_CHANGED')
  }
  if (hashOutcomeSuccessorValue(frozenContractPacks(sourcePlan))
    !== hashOutcomeSuccessorValue(frozenContractPacks(candidate))) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_OUTPUT_CONTRACT_CHANGED')
  }
}

const frozenContractPacks = (plan) => {
  const types = ['OUTPUT_TYPE_DEFINITION', 'OUTPUT_SCHEMA', 'STYLE']
  const packs = plan.payload?.resolution?.selectedPacks
  if (!Array.isArray(packs) || types.some((type) => !packs.some((pack) => pack.packType === type))) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_SOURCE_CONTRACT_INCOMPLETE')
  }
  return packs.filter((pack) => types.includes(pack.packType)).map((pack) => {
    if (['activationId', 'packId', 'versionId', 'packKey', 'semanticVersion'].some((field) => !id(pack[field]))
      || !/^sha256:[a-f0-9]{64}$/.test(pack.contentHash)) {
      throw outcomeSuccessorError('OUTCOME_SUCCESSOR_SOURCE_CONTRACT_INCOMPLETE')
    }
    return Object.fromEntries(['activationId', 'packId', 'versionId', 'packType', 'packKey', 'semanticVersion', 'contentHash']
      .map((field) => [field, pack[field]]))
  }).sort((a, b) => `${a.packType}:${a.packKey}:${a.versionId}`.localeCompare(`${b.packType}:${b.packKey}:${b.versionId}`))
}
