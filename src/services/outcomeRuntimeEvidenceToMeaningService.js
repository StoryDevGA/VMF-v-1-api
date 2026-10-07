import { compileEvidenceToMeaningContract, assertEvidenceToMeaningContract,
  hashEvidenceToMeaningValue } from './outcomeEvidenceToMeaningContractService.js'
import { projectOutcomeSelectedTargetBinding } from './outcomeSelectedTargetService.js'
import { OUTCOME_SELECTED_TARGET_CONTRACT_VERSION } from '../constants/outcomeSelectedTarget.js'
import { projectOutcomeStudioBusinessFactLedger, buildIntermediateReasoningManifest } from './outcomeStudioEvidenceCompositionService.js'
import { resolveOutcomeStudioCompositionInputs, buildKnowledgeContextForComposition } from './outcomeStudioLiveCompositionBridgeService.js'
import { loadOutcomeKnowledgePackVersionContent } from './outcomeKnowledgePackRegistryService.js'
import { getRuntimeOutcomeEvidenceContractSnapshot } from './runtimeStateRepository.js'
import { projectEvidenceToMeaningProviderContract, EVIDENCE_TO_MEANING_PROVIDER_VERSION,
  EVIDENCE_TO_DRAFT_PROVIDER_VERSION } from './outcomeEvidenceToMeaningProviderService.js'
import { EVIDENCE_TO_DRAFT_INPUT_VERSION } from './outcomeEvidenceToDraftContractService.js'
import { OUTCOME_PLANNING_EVIDENCE_VERSIONS } from './outcomeFrameworkHandoffService.js'

const json = (value) => JSON.parse(JSON.stringify(value))
const same = (left, right) => hashEvidenceToMeaningValue(left) === hashEvidenceToMeaningValue(right)
const error = (reason, contract = null) => Object.assign(new Error('Clarification is required before draft generation.'), {
  status: 409, code: 'EVIDENCE_TO_MEANING_CLARIFICATION_REQUIRED', details: {
    reason, contractId: contract?.contractId || '', contractHash: contract?.contractHash || '',
    fingerprints: contract?.fingerprints || {}, sectionLedger: contract?.sectionLedger || [],
    clarification: contract?.clarification?.required ? projectPersistedEvidenceClarification(contract) : {
      version: 'evidence-to-meaning-clarification.v1', required: true,
      code: 'EVIDENCE_TO_MEANING_CLARIFICATION_REQUIRED', firstBoundary: reason,
      affectedSections: contract?.sectionLedger || [], missingFields: [reason],
      questions: [{ field: reason, question: 'Re-resolve the request against current governed evidence before generating a draft.' }],
    },
  },
})
// Recovery is derived from the validated immutable receipt; historical bytes/hashes never change.
const projectPersistedEvidenceClarification = (contract) => {
  const original = contract.clarification
  const targetError = contract.inputs?.composition?.targetReadError
  if (targetError && typeof targetError.field === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,159}$/.test(targetError.field)) {
    const field = targetError.field
    return { ...original, missingFields: [field], questions: [{ field, missingInput: field,
      reasons: ['SELECTED_TARGET_BINDING_UNRESOLVED'],
      question: `Resolve the governed input "${field}" before confirming a new request plan.`,
      nextAction: 'Resolve the governed output binding and re-resolve the request.',
    }] }
  }
  if (original.firstBoundary !== 'sourceSnapshot.SECTION_REFERENCE_UNRESOLVED') return original
  const coverage = contract.inputs.sourceSnapshot.inventoryReceipt.sectionCoverage
  const receipt = contract.inputs.sourceSnapshot.inventoryReceipt
  const missingContradictions = receipt.contradictionReferences.filter((reference) =>
    !receipt.collections.evidence.records.some((record) => record.id === reference || record.sourceReference === reference))
  const affectedSections = coverage.filter((section) => section.missingReferences.length).map((section) => ({
    sourceSectionKey: section.sectionKey, missingReferences: [...section.missingReferences],
    reasons: ['SECTION_REFERENCE_UNRESOLVED'],
  }))
  return { ...original, affectedSections,
    missingFields: affectedSections.flatMap((section) => section.missingReferences.map((reference) =>
      `sectionCoverage.${section.sourceSectionKey}.${reference}`)).concat(
      missingContradictions.map((reference) => `contradictionReferences.${reference}`)),
    questions: affectedSections.flatMap((section) => section.missingReferences.map((reference) => ({
      field: `sectionCoverage.${section.sourceSectionKey}.${reference}`,
      sourceSectionKey: section.sourceSectionKey, missingReference: reference,
      question: `Which current governed evidence resolves the stored reference "${reference}" in "${section.sourceSectionKey}"?`,
    }))).concat(missingContradictions.map((reference) => ({
      field: `contradictionReferences.${reference}`, missingReference: reference,
      question: `Which current governed evidence resolves the stored contradiction reference "${reference}"?`,
    }))),
  }
}
const truthProjection = (payload) => ({ lockedTruth: payload.lockedTruth,
  frameworkHandoff: payload.planningEvidence?.frameworkHandoff || null })
export const projectRuntimeEvidenceOutputPlanBinding = (payload) => ({
  resolutionFingerprint: payload.resolution?.resolutionFingerprint || '',
  contextFingerprint: payload.governedContext?.contextFingerprint || '',
  selectedPacks: payload.resolution?.selectedPacks || [],
  outputType: payload.governedContext?.outputType || null,
  outputSchema: payload.governedContext?.outputSchema || null,
})
const outputPlanProjection = projectRuntimeEvidenceOutputPlanBinding
export const runtimeEvidenceStageDependencies = (deps) => ({
  ...(deps.stageDeps || {}),
  ...(deps.readOutcomeEvidenceContractSnapshot
    ? { readOutcomeEvidenceContractSnapshot: deps.readOutcomeEvidenceContractSnapshot } : {}),
})

export const buildRuntimeEvidenceToMeaningReceipt = async ({ runtime, binding, context, candidate,
  scopes, session = null, deps = {} }) => {
  let sourceSnapshot
  try {
    sourceSnapshot = await (deps.readOutcomeEvidenceContractSnapshot || getRuntimeOutcomeEvidenceContractSnapshot)({
      runtimeInstanceId: runtime._id || runtime.id, scopes, session })
  } catch (failure) {
    sourceSnapshot = { evidenceObjects: [], sourceRegistry: [], readError: { code: failure.code || 'SOURCE_SNAPSHOT_UNAVAILABLE' },
      ...(failure.details?.snapshotReceipt ? { inventoryReceipt: failure.details.snapshotReceipt } : {}) }
  }
  let selectedTarget = null
  let outputBinding = { outputTypeKey: candidate.payload.consumerIntent.requestedOutputTypeKey,
    outputSchemaKey: context?.outputSchema?.key || '', requiredSections: [], optionalSections: [],
    lineage: binding?.lineage || {} }
  let targetReadError = null
  try {
    const resolved = await resolveOutcomeStudioCompositionInputs({ binding, knowledgeContext: context,
      requestedOutputTypeKey: candidate.payload.consumerIntent.requestedOutputTypeKey,
      requestedFormat: candidate.payload.consumerIntent.format || '',
      ...(candidate.payload.planningEvidence?.contractVersion === OUTCOME_PLANNING_EVIDENCE_VERSIONS.V2
        ? { frameworkHandoff: candidate.payload.planningEvidence.frameworkHandoff } : {}),
      loadPackContent: (args) => (deps.loadPackContent || loadOutcomeKnowledgePackVersionContent)({ ...args, session }) })
    const composedContext = buildKnowledgeContextForComposition({ knowledgeContext: context, binding, ...resolved,
      loadedPacks: [resolved.outputType, resolved.schema, resolved.arl, resolved.rl].filter(Boolean) })
    const projected = projectOutcomeSelectedTargetBinding({ contract: {
      outputType: { ...resolved.outputType, actualContentHash: resolved.outputType.contentHash },
      schema: { ...resolved.schema, actualContentHash: resolved.schema.contentHash }, schemaProjection: resolved.schemaProjection } })
    selectedTarget = { contractVersion: OUTCOME_SELECTED_TARGET_CONTRACT_VERSION,
      receipt: projected.receipt, receiptFingerprint: projected.receiptFingerprint }
    outputBinding = { outputTypeKey: composedContext.outputType.key, outputSchemaKey: composedContext.outputSchema.key,
      outputTypeVersion: composedContext.outputType.version, outputSchemaVersion: composedContext.outputSchema.version,
      requiredSections: composedContext.outputSchema.requiredSections, optionalSections: composedContext.outputSchema.optionalSections,
      outputTypeStructure: composedContext.outputTypeStructure, lineage: composedContext.lineage }
  } catch (failure) {
    targetReadError = { code: failure.code || 'SELECTED_TARGET_UNAVAILABLE', field: failure.details?.field || 'selectedTarget' }
  }
  const frameworkState = { ...runtime.framework_state, evidence_pack: sourceSnapshot }
  let businessFactLedger
  let frameworkIntelligence = null
  try {
    businessFactLedger = projectOutcomeStudioBusinessFactLedger({ frameworkState, truthBinding: { currentness: 'UNKNOWN' },
      runtimeInstanceId: String(runtime._id || runtime.id) })
    frameworkIntelligence = buildIntermediateReasoningManifest({
      frameworkHandoff: candidate.payload.planningEvidence?.frameworkHandoff || {},
      knowledgeContext: context, enforceMissing: false,
    })?.frameworkIntelligence || null
  } catch (failure) {
    businessFactLedger = { facts: [], omitted: [], contradictions: [], projectionError: { code: failure.code || 'LEDGER_PROJECTION_INVALID' } }
  }
  const intent = json(candidate.payload.consumerIntent)
  const input = json({ composition: {
    contractVersion: EVIDENCE_TO_DRAFT_INPUT_VERSION,
    runtimeBinding: candidate.payload.runtime, truthBinding: truthProjection(candidate.payload),
    outputPlanBinding: outputPlanProjection(candidate.payload),
    requestBinding: { ...intent, requestId: candidate.payload.requestId || '' },
    outputBinding, businessFactLedger, targetReadError, frameworkIntelligence,
  }, selectedTarget, sourceSnapshot, request: { audience: intent.audience || [], format: intent.format || '' } })
  let contract = compileEvidenceToMeaningContract(input)
  if (contract.status === 'READY_TO_DRAFT') {
    try {
      projectEvidenceToMeaningProviderContract(contract)
      input.composition.providerCompatibility = { contractVersion: EVIDENCE_TO_DRAFT_PROVIDER_VERSION, status: 'READY' }
    } catch (failure) {
      input.composition.providerCompatibility = { contractVersion: EVIDENCE_TO_DRAFT_PROVIDER_VERSION,
        status: 'CLARIFICATION_REQUIRED', missingFields: failure.details?.clarification?.missingFields || ['providerCompatibility'] }
    }
    contract = compileEvidenceToMeaningContract(input)
  }
  return { contractVersion: contract.contractVersion, contractId: contract.contractId,
    contractHash: contract.contractHash, contractJson: JSON.stringify(contract) }
}

export const readRuntimeEvidenceToMeaningContract = (plan, { required = true } = {}) => {
  const receipt = plan?.payload?.evidenceToMeaning
  if (!receipt) { if (required) throw error('CONTRACT_REQUIRED_RE_RESOLVE_REQUEST'); return null }
  let contract
  try {
    if (Object.keys(receipt).sort().join(',') !== 'contractHash,contractId,contractJson,contractVersion'
      || typeof receipt.contractJson !== 'string' || Buffer.byteLength(receipt.contractJson) > 2000000) throw new Error('shape')
    contract = assertEvidenceToMeaningContract(JSON.parse(receipt.contractJson))
    const payload = plan.payload
    if (contract.contractVersion === 'evidence-to-draft.v2') {
      const scope = contract.inputs.sourceSnapshot?.inventoryReceipt?.scope
      if (scope && ['tenantId', 'customerId', 'runtimeInstanceId'].some((field) =>
        plan[field] && String(plan[field]) !== scope[field])) throw new Error('scopeBinding')
    }
    if (contract.contractId !== receipt.contractId || contract.contractHash !== receipt.contractHash
      || contract.contractVersion !== receipt.contractVersion
      || !same(contract.inputs.composition.runtimeBinding, payload.runtime)
      || !same(contract.inputs.composition.truthBinding, truthProjection(payload))
      || !same(contract.inputs.composition.outputPlanBinding, outputPlanProjection(payload))
      || !same(contract.inputs.composition.requestBinding, { ...payload.consumerIntent, requestId: payload.requestId || '' })) throw new Error('binding')
    const target = contract.inputs.selectedTarget?.receipt?.contractIdentity
    if (target) {
      for (const [role, identity] of Object.entries(target)) {
        const selection = identity.selection
        const packs = payload.resolution?.selectedPacks?.filter((pack) => pack.activationId === selection.activationId) || []
        if (packs.length !== 1 || ['packId', 'versionId', 'semanticVersion', 'packKey', 'capabilityKey', 'contentHash']
          .some((field) => packs[0][field] !== selection[field])) throw new Error('selectedPackBinding')
        const context = role === 'schema' ? payload.governedContext?.outputSchema : payload.governedContext?.outputType
        if (context?.key !== selection.capabilityKey || context?.version !== selection.semanticVersion) throw new Error('outputBinding')
      }
    }
  } catch { throw error('CONTRACT_INTEGRITY_OR_BINDING_INVALID') }
  return contract
}

export const readRuntimeEvidenceToMeaningProviderProjection = (plan) => {
  const contract = readRuntimeEvidenceToMeaningContract(plan)
  const policy = contract.inputs.composition.providerCompatibility
  if (!policy && !plan.payload.requestId) return null // Unscoped legacy contracts retain their existing provider representation.
  const expectedVersion = contract.contractVersion === 'evidence-to-draft.v2' ? EVIDENCE_TO_DRAFT_PROVIDER_VERSION : EVIDENCE_TO_MEANING_PROVIDER_VERSION
  if (policy?.contractVersion !== expectedVersion || policy?.status !== 'READY') {
    throw error('PROVIDER_CONTRACT_REQUIRED_RE_RESOLVE_REQUEST', contract)
  }
  return projectEvidenceToMeaningProviderContract(contract)
}

const snapshotReadinessSummary = (snapshot) => {
  const receipt = snapshot?.inventoryReceipt
  return receipt ? {
    completeness: receipt.completeness, totalEvidenceCount: receipt.collections?.evidence?.totalCount ?? null,
    totalSourceCount: receipt.collections?.sources?.totalCount ?? null,
    snapshotVersion: snapshot.snapshotVersion || receipt.version || '', stateVersion: snapshot.stateVersion || receipt.scope?.stateVersion || '',
    projectedEvidenceCount: receipt.selectedEvidenceIds?.length ?? 0, overallHash: receipt.overallHash || '',
    reason: receipt.reason || '', sectionReadiness: receipt.sectionReadiness || 'NOT_ASSESSED',
    unresolvedSectionReferenceCount: (receipt.sectionCoverage || [])
      .reduce((count, section) => count + (section.missingReferences || []).length, 0),
    unresolvedReferences: (receipt.sectionCoverage || []).flatMap((section) =>
      (section.missingReferences || []).map((missingReference) => ({ sourceSectionKey: section.sectionKey, missingReference }))),
  } : { completeness: 'NOT_ASSESSED', reason: 'INVENTORY_RECEIPT_REQUIRED' }
}
const snapshotFailureReasons = new Set([
  'COUNT_INVALID', 'PAGE_MISSING_OR_INVALID', 'DUPLICATE_OR_UNORDERED_RECORD', 'COUNT_CHANGED',
  'INVENTORY_BYTE_BOUND', 'RECORDS_CHANGED', 'SOURCE_REFERENCE_MISSING', 'READ_UNAVAILABLE',
  'CONTROL_CHANGED', 'PROJECTION_BOUND', 'SCOPE_MISMATCH', 'OUTCOME_EVIDENCE_SCOPE_MISMATCH',
].map((reason) => `OUTCOME_EVIDENCE_SNAPSHOT_${reason}`).concat('OUTCOME_EVIDENCE_SCOPE_MISMATCH'))
const projectSnapshotFailure = (failure) => {
  const reason = snapshotFailureReasons.has(failure?.code) ? failure.code : 'SOURCE_SNAPSHOT_UNAVAILABLE'
  const receipt = failure?.details?.snapshotReceipt
  const count = receipt?.collections?.evidence?.totalCount
  return { reason, completeness: 'INCOMPLETE',
    totalEvidenceCount: Number.isSafeInteger(count) && count >= 0 ? count : null,
    overallHash: typeof receipt?.overallHash === 'string' && /^[a-f0-9]{64}$/.test(receipt.overallHash) ? receipt.overallHash : '',
  }
}
export const readCurrentRuntimeEvidenceSnapshotReadiness = async ({ runtimeInstanceId, scopes, deps = {} }) => {
  try {
    const snapshot = await (deps.readOutcomeEvidenceContractSnapshot || getRuntimeOutcomeEvidenceContractSnapshot)({ runtimeInstanceId, scopes })
    return { ...snapshotReadinessSummary(snapshot), diagnosticOnly: true,
      unresolvedContradictionCount: snapshot.discoveryHealth?.unresolvedContradictionCount
        ?? snapshot.discoveryHealth?.contradictionCount ?? null,
      missingAreas: snapshot.discoveryHealth?.missingAreas || [] }
  } catch (failure) {
    return { ...snapshotReadinessSummary({ inventoryReceipt: failure.details?.snapshotReceipt }),
      completeness: 'INCOMPLETE', reason: failure.code || 'SOURCE_SNAPSHOT_UNAVAILABLE', diagnosticOnly: true,
      missingAreas: [], unresolvedContradictionCount: null }
  }
}

export const projectRuntimeEvidenceToMeaningReadiness = (plan) => {
  const contract = readRuntimeEvidenceToMeaningContract(plan, { required: false })
  if (!contract) return { status: 'CLARIFICATION_REQUIRED', canExecute: false,
    clarification: error('CONTRACT_REQUIRED_RE_RESOLVE_REQUEST').details.clarification }
  if (['READY', 'READY_TO_DRAFT'].includes(contract.status)) {
    try {
      if (plan.payload.requestId) readRuntimeEvidenceToMeaningProviderProjection(plan)
      else projectEvidenceToMeaningProviderContract(contract)
    } catch (failure) {
      return { contractVersion: contract.contractVersion, contractId: contract.contractId,
        contractHash: contract.contractHash, status: 'CLARIFICATION_REQUIRED', canExecute: false,
        fingerprints: contract.fingerprints, sectionLedger: contract.sectionLedger, clarification: failure.details.clarification }
    }
  }
  return { contractVersion: contract.contractVersion, contractId: contract.contractId,
    contractHash: contract.contractHash, status: contract.status, canExecute: ['READY', 'READY_TO_DRAFT'].includes(contract.status),
    fingerprints: contract.fingerprints, sectionLedger: contract.sectionLedger, clarification: projectPersistedEvidenceClarification(contract),
    snapshotReadiness: snapshotReadinessSummary(contract.inputs.sourceSnapshot),
    ...(contract.contradictionLedger ? { contradictionLedger: contract.contradictionLedger.map(({ candidateId, evidenceReferences, disposition, affectedSectionKeys, dimensions }) =>
      ({ candidateId, evidenceReferences, disposition, affectedSectionKeys, dimensions })) } : {}) }
}

export const assertRuntimeEvidenceToMeaningReady = async ({ plan, scopes, session = null, deps = {} }) => {
  const contract = readRuntimeEvidenceToMeaningContract(plan)
  if (!['READY', 'READY_TO_DRAFT'].includes(contract.status)) throw error(contract.clarification.firstBoundary, contract)
  projectEvidenceToMeaningProviderContract(contract)
  if (plan.payload.requestId) readRuntimeEvidenceToMeaningProviderProjection(plan)
  let current
  try {
    current = await (deps.readOutcomeEvidenceContractSnapshot || getRuntimeOutcomeEvidenceContractSnapshot)({
      runtimeInstanceId: plan.runtimeInstanceId || plan.payload.runtime.runtimeInstanceId, scopes, session })
  } catch (failure) {
    const snapshotReadiness = projectSnapshotFailure(failure)
    const blocked = error(snapshotReadiness.reason, contract)
    blocked.details.snapshotReadiness = snapshotReadiness
    throw blocked
  }
  // Recompile against the same snapshot normalizer, which sorts identity collections.
  const replay = compileEvidenceToMeaningContract({ ...contract.inputs, sourceSnapshot: current })
  if (replay.contractHash !== contract.contractHash) throw error('SOURCE_SNAPSHOT_CHANGED_RE_RESOLVE_REQUEST', contract)
  return contract
}
