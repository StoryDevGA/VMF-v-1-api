import OutcomeKnowledgeCompositionPlan from '../../models/OutcomeKnowledgeCompositionPlan.js'
import { assertOutcomeKnowledgeCompositionPlanIntegrity } from '../outcomeKnowledgeCompositionPlanService.js'
import { readRuntimeEvidenceToMeaningContract } from '../outcomeRuntimeEvidenceToMeaningService.js'
import { matchesEvidenceToMeaningFrozenRecord } from '../outcomeEvidenceToMeaningContractService.js'

const fail = (code, status = 422) => { throw Object.assign(new Error('The saved assessment condition cannot be bound.'), { code, status }) }

// Runtime access was already authorized by the context resolver. Query the exact
// immutable request plan in that scope; a caller's plan ID grants no access.
export const resolveVE02ClaimBinding = async ({ binding, context, statement, session, dependencies = {} }) => {
  if (!binding) return null
  if (!session?.inTransaction()) fail('VE02_CLAIM_SNAPSHOT_REQUIRED')
  const filter = { planId: binding.planId, requestId: binding.requestId,
    runtimeInstanceId: context.runtimeId, customerId: context.customerId, tenantId: context.tenantId,
    packageKey: context.packageKey, packageVersion: context.packageVersion }
  const plan = await (dependencies.readPlan || ((query) => OutcomeKnowledgeCompositionPlan.findOne(query)
    .session(session).maxTimeMS(2000).lean()))(filter)
  if (!plan) fail('VE02_CLAIM_PLAN_NOT_FOUND', 404)
  let contract
  try {
    (dependencies.assertPlan || assertOutcomeKnowledgeCompositionPlanIntegrity)(plan)
    contract = (dependencies.readContract || readRuntimeEvidenceToMeaningContract)(plan)
  } catch { fail('VE02_CLAIM_CONTRACT_INVALID') }
  const snapshot = contract.inputs.sourceSnapshot
  const scope = snapshot?.inventoryReceipt?.scope
  if (!scope || ['runtimeInstanceId', 'customerId', 'tenantId'].some((key) => String(scope[key]) !== String(filter[key]))
    || scope.stateVersion !== context.stateVersion) fail('VE02_CLAIM_BASIS_CHANGED', 409)
  const claims = contract.customerClaims?.filter((claim) => claim.claimKey === binding.claimKey) || []
  if (claims.length !== 1) fail('VE02_CLAIM_NOT_FOUND')
  const claim = claims[0]
  const evidence = context.claimEvidence || context.evidence
  const source = context.claimSource || context.source
  const frozenEvidence = snapshot.evidenceObjects?.filter(row => row.evidenceObjectId === evidence.evidenceObjectId) || []
  const frozenSources = snapshot.sourceRegistry?.filter(row => row.sourceId === source.sourceId) || []
  if (claim.evidenceReference !== evidence.evidenceObjectId || claim.sourceReference !== source.sourceId
    || claim.statement !== statement || claim.statement !== (evidence.extractedFact || evidence.summary || evidence.title || '')
    || claim.restriction !== 'EXACT_STATEMENT_ONLY'
    || !matchesEvidenceToMeaningFrozenRecord({ current: evidence, frozen: frozenEvidence.length === 1 ? frozenEvidence[0] : null, expectedHash: claim.evidenceHash })
    || !matchesEvidenceToMeaningFrozenRecord({ current: source, frozen: frozenSources.length === 1 ? frozenSources[0] : null, expectedHash: claim.sourceHash })) fail('VE02_CLAIM_BASIS_CHANGED', 409)
  return { planId: plan.planId, requestId: plan.requestId, planFingerprint: plan.planFingerprint,
    contractHash: contract.contractHash, claimKey: claim.claimKey, statement: claim.statement,
    evidenceHash: claim.evidenceHash, sourceHash: claim.sourceHash, admission: claim.admission,
    restriction: 'EXACT_STATEMENT_ONLY', status: 'CURRENT_SAVED_CONDITION', hypothesisAuthority: false }
}
