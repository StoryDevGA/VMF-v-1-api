import mongoose from 'mongoose'
import env from '../config/env.js'
import Audit from '../models/AuditLog.js'
import { REVIEW_COMPLETION_VERSION, REVIEW_POPULATION_POLICY } from '../models/RuntimeReviewCompletion.js'
import { SYNTHETIC_REVISION_TEST_POLICY as p } from '../constants/syntheticRevisionTestPolicy.js'
import { membershipHash, membershipJson } from './runtimeEvidenceSnapshotContract.js'
import { compileReviewPopulation } from './reviewCompletionService.js'
import { getDiscoveryContradictionReview } from './discoveryContradictionReviewService.js'
import { compileQualifiedRevisionMaterial, syntheticRevisionRows, requireSyntheticRevision as need } from './syntheticRevisionTestBasis.js'

// Observed technical witness for the already authorised, recorded R3 case.
// This does not amend the original test-only policy or confer semantic authority.
export const RECORDED_SYNTHETIC_REVIEW_WITNESS = Object.freeze({
  route: 'RECORDED_NATIVE_REVIEW_COMPLETION',
  materialHash: 'a3a848d56ecd00e9b0eac965af762f645bb0f02cd1e04b82b05cd553f7481a7b',
  stateVersion: 'rsv2:3fc00a8f-7c06-4dd0-8bc4-3bf0ec85cb18',
  completedAt: '2026-10-20T13:18:55.403Z',
  completionId: 'd3af4ca0-0f05-47f9-8b6d-53411705c856',
  populationHash: 'd407a541bf3917929239083b8a827a044f138357fc22f2ee9cd5025bfb3c3b3d',
  reviewId: 'b2404a75-e3c0-45a5-9a4f-5c7c22136a98',
  reviewHash: '7b518009dd6e1a7e59bf865226d1503f63a254a09729a474c08bdd22c8742791',
  reviewAuditId: '6ad75fd8cecaa729e47e1d4e',
  reviewerId: '6a6c763dcace7a21bd41efa9',
  delegationReference: 'ss044-r3-synthetic-review-delegation.2026-10-20.v1',
  delegationHash: 'c6a8acc8eb24b1bdc4d45e6b3b50978daa33a023805119cf52ac218561e14d61',
})
const w = RECORDED_SYNTHETIC_REVIEW_WITNESS
// Observed native refresh, independently checked against the original witness.
// Graph promotion does not sign the final root timestamp: updatedAt is an
// observed CAS anchor. The named audit fingerprints still require real HMACs.
export const RECORDED_SOURCE_REFRESH_WITNESS = Object.freeze({
  version: 'recorded-r3-managed-source-refresh.v1',
  stateVersion: 'rsv2:5ec4900a-ef3f-42f5-a978-b8d328429004',
  updatedAt: '2026-10-20T14:07:45.682Z',
  materialHash: 'a284ffad8709cd42c91fd68ab0c83465e87cce6797b1a424d48dde282dc6e02a',
  evidenceAcceptanceHash: '491c6759b13c477f842b5fba182a6ecbf21f9b8188e852e508d13fea491bbf52',
  sections: [
    ['strategic_objectives', '3a6213042d8ea723f5bca19d1c351241da2089659ece50fd6463ebc516e6a0c5', '490f38c3b004b28f8555cd05a891df713b4c38d57ee980d7d5b67408512532ae', '26639aa9ae9d8b64759c48da9e46a62405c0df1059f757aa029e5e7e528f496b', 'ad38ffd965327968eb77ded740a0233a6b1bebbd05f3edc369897650889e5c28', 'resp_0b0d6d3e61699c5a016ad77319702887d2bfbdf400ee04a5b0', '6d8e8c658b5051928c62cb2615d8d5b1f5cd85b31eb398dd67d58647d6081199'],
    ['current_state_assessment', 'fa6163021a2b75f07246c36b9c3b86e9281c308d31521003e37e957637ef1fd2', '4e3a369c84fad2edd60729ef25fb4dae64b1cd16760806a32ee83fd1e520e052', '9151d6430a577f6af75c2851b8d316f0800cd494e196b3296759e885315dfaf0', 'ffa3d9664a65ac3a08eef05eee1e235a8e4c4420131779e5021b030c412fc087', 'resp_0bf2128f0e59af02016ad77449eafc87d2bce321b856ba97f3', '07d48511f1718b25237a07eea3b8706edba6f7ff03aac0cba659634db9e7fde0'],
    ['evidence_register', '13d7b2a9c8f75f0897886eaf3b52a2a914a8ab216160716d60fcced72007aa17', 'a80140eceedc71031566e250aba121950a852a320694796b6dcd8ea6f54301c6', '0c1d9a7d732863c764fd1ddc0fabed76176fc1d2275f0ab16ea19ae1359b7653', '27f27e58d8d7066a9e656d28940a295d412e4f9bf5225b04585cba489c7ce7d9', 'resp_0cace0e802c9b473016ad774e8af9c87d29855b985a7d7e4e9', 'a5c301fa4ea9ac89492c872a372d4748ac32ea20291a8e8989f92475b2daae69'],
  ],
  audits: [
    ['6ad76d887c526dfd5497f172', '48de875b371866aca81699dabed676c633847ef05650b623323151f1cef76cda'],
    ['6ad771377c526dfd5497f39c', '0b6173121d567e5e5fc2afa2dae08a7922e31c3acf5bd9fc5c1e918e2bd02aaf'],
    ['6ad771397c526dfd5497f60d', 'c59e366f9de2a1eed817744e7b9a4dd0b6cde123d6d54935efdd42e5adf8112a'],
    ['6ad773377c526dfd5497f7b5', '4aaf95050f0291f5478557a9c3290e5d25e2cca206cc450249f61f909b62d6af'],
    ['6ad773387c526dfd5497fa0b', 'edddd8c5eecfeb3b2c567bcfba304fb51a86e7cba7c42b9478a2b511e3f1f23d'],
    ['6ad7740b7c526dfd5497fb8a', 'd16ee6368f210c1fa011be6e1c2ba7d93caa46f1671966e0627d6ba656d25297'],
    ['6ad7740d7c526dfd5497fdfb', 'c03905c67b44b57ad6860a2906f7b11030e1a4818033782705fe95f6e74b9ef9'],
    ['6ad774667c526dfd5497ff8e', '9421f1ccb14c77fd8a412f0f72e59f8b0ef44b1532e10459265c66bd0e3d9d9a'],
    ['6ad774677c526dfd549801e1', '8f34c2b6ead8a0a3ef91d82d49c390d77fccef6aae7d2dec4044e5f1c9cc35f2'],
    ['6ad774b87c526dfd5498034c', '0626493df3d1f13f2f8ba8a1a97e13e214e46c8318020d9a0d790d23664632ae'],
    ['6ad774ba7c526dfd549805bd', '8eabb3cea71b6aeedfcd5389fe3b521f98adedec80cba7f7f07a848c81ceefc4'],
    ['6ad774f47c526dfd54980752', '61f4c64459be1e7eb7829de885602a009bc2d1fb9d71826529f2dab7a1334ffa'],
    ['6ad774f57c526dfd5498099f', '635b43b364e379f00117767319bfe2cd1f174d5a1b84156be5b04fc4bca873e0'],
    ['6ad775b17c526dfd54980ba2', 'a51e98ba026abb6096497e6e5313247861a1c3d4d63a3f3531536d54787aeefc'],
    ['6ad775b27c526dfd54980e13', 'ac790d581b2ae4c4e03d42ce7f56c75684afea793a2f15fb52a770847f95e560'],
  ],
})
const f = RECORDED_SOURCE_REFRESH_WITNESS
const scope = () => ({ customerId: new mongoose.Types.ObjectId(p.customerId), tenantId: new mongoose.Types.ObjectId(p.tenantId),
  runtimeInstanceId: new mongoose.Types.ObjectId(p.runtimeInstanceId), runtimeInstanceKey: p.runtimeInstanceKey })
const auditScope = () => Object.fromEntries(Object.entries(scope()).map(([k, v]) => ['scope.' + k, v]))
const validScope = row => ['customerId', 'tenantId', 'runtimeInstanceId', 'runtimeInstanceKey'].every(k => String(row?.[k]) === p[k])
const defaultReadOne = (name, filter, session) => mongoose.connection.db.collection(name).findOne(filter, { session, maxTimeMS: 2000 })

// Exact observed historical promotion: its audit did not sign root timestamps.
// This attests only this disposable R3 case, never arbitrary timestamp drift.
export const RECORDED_PUBLISH_GRAPH_WITNESS = Object.freeze({
  contractVersion: 'recorded-r3-publish-graph-bridge.v1',
  stateVersion: 'rsv2:043e1009-b81a-4152-8c49-99fd60934736',
  observedRootUpdatedAt: '2026-10-20T14:38:41.561Z',
  actionAuditId: '6ad77cf116b708d882899f72',
  actionAuditHash: '829f156d6f5eedcdfa09129ddee8a171e07a24bbe812b348154f61afb7df0897',
  actionUpdatedAtAfter: '2026-10-20T14:38:38.419Z',
  promotionAuditId: '6ad77cf216b708d88289a1f5',
  promotionAuditHash: 'bc202607e81e78ae7c1a2618b53a8f46d27619316b3060875b85a38dd3fb32ee',
  graphDocumentId: '6ad77cf116b708d88289a11c',
  graphMaterialHash: '4a646519722c78fcae1f128b609213345d16834dd5776e6a167ea0e4e837849e',
})
const g = RECORDED_PUBLISH_GRAPH_WITNESS
const immutableGraph = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['current', 'stateStatus', 'updatedAt'].includes(key)))
const verifyGraphCurrentness = async ({ action, version, time, read, signed, session }) => {
  const historical = version === g.stateVersion
  const promotions = await read('auditlogs', { resourceId: new mongoose.Types.ObjectId(p.runtimeInstanceId),
    ...auditScope(), action: 'RUNTIME_STATE_MUTATED', 'diff.operation': 'V2_GRAPH_REBUILD_PROMOTED',
    'diff.sourceStateVersion': version }, session, 1)
  const promotion = promotions[0], d = promotion?.diff
  need(promotions.length === 1 && signed(promotion) && validScope(promotion.scope)
    && promotion.resourceType === 'RuntimeInstance' && String(promotion.resourceId) === p.runtimeInstanceId
    && d?.sourceStateVersion === version && d.graphHash === action.diff.intelligenceGraph?.nextGraphHash
    && typeof d.newSnapshotId === 'string' && d.newSnapshotId === 'rgs:' + d.graphHash?.replace(/^sha256:/, ''),
  'RECORDED_GRAPH_PROMOTION_INVALID')
  const graphs = await read('runtime_graph_snapshots', { ...scope(), snapshotId: d.newSnapshotId, stateVersion: version }, session, 1)
  const graph = graphs[0]
  need(graphs.length === 1 && validScope(graph) && graph.stateVersion === version && graph.sourceStateVersion === version
    && graph.snapshotId === d.newSnapshotId && graph.graphHash === d.graphHash && /^sha256:[a-f0-9]{64}$/.test(graph.sourceHash)
    && ((graph.current === true && graph.stateStatus === 'CURRENT') || (graph.current === false && graph.stateStatus === 'STALE'))
    && graph.counts?.nodeCount === d.counts?.nodeCount && graph.counts?.edgeCount === d.counts?.edgeCount,
  'RECORDED_GRAPH_RECORD_INVALID')
  if (historical) {
    need(action.diff.actionKey === 'PUBLISH' && String(action._id) === g.actionAuditId && membershipHash(action) === g.actionAuditHash
      && action.diff.updatedAtAfter === g.actionUpdatedAtAfter && time === g.observedRootUpdatedAt
      && String(promotion._id) === g.promotionAuditId && membershipHash(promotion) === g.promotionAuditHash
      && String(graph._id) === g.graphDocumentId && membershipHash(immutableGraph(graph)) === g.graphMaterialHash,
    'RECORDED_PUBLISH_GRAPH_WITNESS_INVALID')
  } else {
    const transition = d.rootUpdatedAtTransition
    need(transition?.contractVersion === 'runtime-graph-root-currentness.v1'
      && transition.before === action.diff.updatedAtAfter && transition.after === time
      && Number.isFinite(Date.parse(transition.before)) && Number.isFinite(Date.parse(transition.after))
      && Date.parse(transition.after) >= Date.parse(transition.before), 'RECORDED_GRAPH_TIMESTAMP_INVALID')
  }
  return historical
}

const verifySourceRefresh = async ({ runtime, basis, read, signed, session }) => {
  need(basis.materialHash === f.materialHash, 'RECORDED_QUALIFIED_MATERIAL_CHANGED')
  const pack = runtime.framework_state.evidence_pack
  need(membershipHash({ accepted: pack.accepted, acceptedAt: pack.acceptedAt, refreshedAt: pack.refreshedAt,
    inputs: pack.inputs, needsRefresh: pack.needsRefresh, needs_refresh: pack.needs_refresh }) === f.evidenceAcceptanceHash,
  'RECORDED_REFRESH_EVIDENCE_STALE')
  const original = membershipJson(basis.manifest)
  for (const [key, generatedHash, acceptedHash, priorAcceptedHash, priorGeneratedHash, responseId, managedHash] of f.sections) {
    const section = runtime.framework_state.sections[key]
    need(section?.review?.status === 'ACCEPTED' && !section.state?.needsRegeneration
      && membershipHash(section.generated) === generatedHash && membershipHash(section.accepted) === acceptedHash
      && section.generated?.generator?.providerMetadata?.responseId === responseId
      && membershipHash(section.generated?.runtimeManagedSourceReceipt) === managedHash
      && section.accepted.sourceGeneratedAt === section.generated.generatedAt, 'RECORDED_REFRESH_SOURCE_INVALID')
    const prior = (section.revisions || []).filter(item => membershipHash(item.accepted) === priorAcceptedHash)
    need(prior.length === 1 && membershipHash(prior[0].generated) === priorGeneratedHash, 'RECORDED_REFRESH_HISTORY_INVALID')
    const entry = original.sections?.find(item => item.key === key)
    need(entry, 'RECORDED_REFRESH_MAPPING_INVALID')
    entry.hash = membershipHash({ input: section.input, accepted: prior[0].accepted, evidenceObjects: section.evidenceObjects,
      additionalEvidence: section.additionalEvidence, gsilContext: section.gsilContext })
  }
  // Only these three accepted truths may differ. Every original input, mapping,
  // qualification, source, finding, package and revision remains under a3a.
  need(membershipHash(original) === w.materialHash, 'RECORDED_REFRESH_ORIGINAL_CHANGED')
  const audits = await read('auditlogs', { _id: { $in: f.audits.map(([id]) => new mongoose.Types.ObjectId(id)) },
    resourceId: new mongoose.Types.ObjectId(p.runtimeInstanceId), ...auditScope() }, session, f.audits.length)
  need(audits.length === f.audits.length && new Set(audits.map(a => String(a._id))).size === f.audits.length,
    'RECORDED_REFRESH_AUDITS_REQUIRED')
  for (const [id, hash] of f.audits) {
    const audit = audits.find(a => String(a._id) === id)
    need(audit && signed(audit) && validScope(audit.scope) && audit.resourceType === 'RuntimeInstance'
      && String(audit.resourceId) === p.runtimeInstanceId && membershipHash(audit) === hash,
    'RECORDED_REFRESH_AUDIT_INVALID')
  }
  return { stateVersion: f.stateVersion, updatedAt: f.updatedAt, witnessHash: membershipHash(f) }
}

export const verifyRecordedSyntheticReviewForLock = async ({ runtime, session, lockAudit = null, deps = {} }) => {
  need(['development', 'test'].includes(env.nodeEnv) && env.appEnv === 'development', 'DEV_TEST_ONLY')
  const read = deps.readRows || syntheticRevisionRows, one = deps.readOne || defaultReadOne
  const signed = deps.verifySignature || (a => Boolean(a && Audit.hydrate(a).verifySignature()))
  const nativeScope = scope()
  delete nativeScope.runtimeInstanceKey
  const records = await read('runtime_review_completions', nativeScope, session, 1)
  const pack = runtime.framework_state?.evidence_pack
  const hasOwnReview = pack?.contradictionReviews?.some(r => String(r?.runtimeInstanceId) === p.runtimeInstanceId)
  // A partial/corrupt recorded route must not fall back to the older test route.
  if (!hasOwnReview && !records.length && !lockAudit?.diff?.recordedReviewCompletion) return null
  need(String(runtime._id || runtime.id) === p.runtimeInstanceId && runtime.runtimeInstanceKey === p.runtimeInstanceKey
    && String(runtime.customerId) === p.customerId && String(runtime.tenantId) === p.tenantId, 'RECORDED_SCOPE_INVALID')
  need(records.length === 1 && hasOwnReview, 'RECORDED_COMPLETION_REQUIRED')
  const receipt = records[0]
  need(validScope(receipt) && receipt.receiptId === w.completionId && receipt.populationHash === w.populationHash
    && receipt.contractVersion === REVIEW_COMPLETION_VERSION && receipt.populationPolicy === REVIEW_POPULATION_POLICY
    && receipt.manifest?.policy === REVIEW_POPULATION_POLICY
    && receipt.observedStateVersion === w.stateVersion && new Date(receipt.completedAt).toISOString() === w.completedAt
    && receipt.authority === 'VMF_UPDATE' && String(receipt.actorUserId) === w.reviewerId
    && membershipHash(receipt.manifest) === receipt.populationHash, 'RECORDED_COMPLETION_INVALID')
  const candidates = pack.discoveryHealth?.contradictionCandidates
  need(candidates?.length === 1 && candidates[0].contradictionId === p.contradictionId, 'RECORDED_FINDING_INVALID')
  const decision = getDiscoveryContradictionReview(candidates[0], pack.evidenceObjects, pack.contradictionReviews,
    p.runtimeInstanceId, pack.contradictionReviewEpoch)
  const review = decision.latestReview
  need(decision.reviewStatus === 'NOT_CONTRADICTORY' && review?.reviewId === w.reviewId
    && String(review.runtimeInstanceId) === p.runtimeInstanceId && review.reviewedBy === w.reviewerId
    && review.evidencePairHash === p.rootEvidencePairHash && membershipHash(review) === w.reviewHash
    && review.rationale.includes(w.delegationReference) && review.rationale.includes(w.delegationHash), 'RECORDED_REVIEW_INVALID')
  const audit = await one('auditlogs', { _id: receipt.auditId, resourceId: new mongoose.Types.ObjectId(p.runtimeInstanceId), ...auditScope() }, session)
  need(signed(audit) && audit.action === 'RUNTIME_STATE_MUTATED' && audit.resourceType === 'RuntimeInstance'
    && validScope(audit.scope) && String(audit.resourceId) === p.runtimeInstanceId
    && audit.signatureVersion === receipt.auditSignatureVersion && String(audit.actorUserId) === w.reviewerId
    && audit.diff?.action === 'REVIEW_COMPLETION' && audit.diff.receiptId === receipt.receiptId
    && audit.diff.populationHash === receipt.populationHash && audit.diff.stateVersion === w.stateVersion
    && audit.diff.populationPolicy === receipt.populationPolicy && audit.diff.rationale === receipt.rationale,
  'RECORDED_COMPLETION_AUDIT_INVALID')
  const reviewAudit = await one('auditlogs', { _id: new mongoose.Types.ObjectId(w.reviewAuditId),
    resourceId: new mongoose.Types.ObjectId(p.runtimeInstanceId), ...auditScope() }, session)
  need(signed(reviewAudit) && reviewAudit.action === 'RUNTIME_STATE_MUTATED' && reviewAudit.resourceType === 'RuntimeInstance'
    && validScope(reviewAudit.scope) && String(reviewAudit.resourceId) === p.runtimeInstanceId
    && String(reviewAudit.actorUserId) === w.reviewerId && membershipHash(reviewAudit.diff?.nextValue?.review) === w.reviewHash,
  'RECORDED_REVIEW_AUDIT_INVALID')
  const basis = await (deps.compileMaterial || compileQualifiedRevisionMaterial)(runtime, session)
  const refresh = basis.materialHash === w.materialHash ? null : await verifySourceRefresh({ runtime, basis, read, signed, session })
  const anchor = refresh || { stateVersion: w.stateVersion, updatedAt: w.completedAt }
  const population = await (deps.compilePopulation || compileReviewPopulation)({ ...runtime, id: String(runtime._id || runtime.id) }, session, Date.now() + 5500)
  need(population.summary.complete && population.summary.confirmedReadinessBlockers === 0
    && population.populationHash === w.populationHash && membershipHash(population.manifest) === w.populationHash,
  'RECORDED_COMPLETION_STALE')
  let version = runtime.stateVersion, time = new Date(runtime.updatedAt).toISOString()
  const visited = new Set(), allowed = ['RUN_VALIDATION', 'MARK_READY', 'SUBMIT_FOR_REVIEW', 'APPROVE', 'PUBLISH', 'LOCK_RECORD']
  let publishGraphVerified = false
  for (let step = 0; step < 16 && version !== anchor.stateVersion; step++) {
    need(!visited.has(version), 'RECORDED_TRANSITION_CYCLE'); visited.add(version)
    const rows = await read('auditlogs', { resourceId: new mongoose.Types.ObjectId(p.runtimeInstanceId),
      action: 'RUNTIME_ACTION_EXECUTED', ...auditScope(), 'diff.syntheticTestStateTransition.to': version }, session, 1)
    const a = rows[0], transition = a?.diff?.syntheticTestStateTransition
    need(rows.length === 1 && signed(a) && a.resourceType === 'RuntimeInstance' && validScope(a.scope)
      && allowed.includes(a.diff?.actionKey) && a.diff.runtimeStateSource?.sourceSetHash
      && transition?.to === version && /^rsv2:[a-f0-9-]{36}$/.test(transition.from), 'RECORDED_TRANSITION_INVALID')
    if (a.diff.updatedAtAfter !== time) {
      publishGraphVerified = await verifyGraphCurrentness({ action: a, version, time, read, signed, session }) || publishGraphVerified
    }
    version = transition.from; time = new Date(a.diff.updatedAtBefore).toISOString()
  }
  need(version === anchor.stateVersion && time === anchor.updatedAt, 'RECORDED_TRANSITION_BOUND')
  const link = { route: w.route, classification: p.classification, authoritative: false,
    reviewId: w.reviewId, reviewHash: w.reviewHash, reviewAuditId: w.reviewAuditId,
    delegationReference: w.delegationReference, delegationHash: w.delegationHash,
    completionId: receipt.receiptId, completionAuditId: String(receipt.auditId), populationHash: w.populationHash,
    materialHash: basis.materialHash, basisStateVersion: anchor.stateVersion,
    ...(publishGraphVerified ? { publishGraphWitnessHash: membershipHash(g) } : {}),
    ...(refresh ? { sourceRefreshWitnessHash: refresh.witnessHash, originalMaterialHash: w.materialHash,
      completionBasisStateVersion: w.stateVersion } : {}) }
  if (lockAudit) need(signed(lockAudit) && lockAudit.action === 'RUNTIME_ACTION_EXECUTED'
    && lockAudit.resourceType === 'RuntimeInstance' && String(lockAudit.resourceId) === p.runtimeInstanceId
    && validScope(lockAudit.scope) && lockAudit.diff?.actionKey === 'LOCK_RECORD'
    && !lockAudit.diff.syntheticTestCompletion && membershipHash(lockAudit.diff.recordedReviewCompletion) === membershipHash(link),
  'RECORDED_LOCK_LINK_INVALID')
  return link
}
