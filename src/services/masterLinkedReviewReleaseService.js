import { createHash } from 'node:crypto'
import User from '../models/User.js'
import Audit from '../models/AuditLog.js'
import Execution from '../models/GovernedReasoningExecution.js'
import auditService from './auditService.js'
import { buildUserPermissionsSnapshot } from './performanceCacheService.js'
import { prepareMasterLinkedDocxReviewTransport, prepareApprovedMasterLinkedDocxReviewTransport, prepareNarrowMasterLinkedDocxReviewTransport } from './outcomeMasterLinkedDocxReviewTransportService.js'
import { buildOpenAiMasterLinkedDocxReviewRequest } from './openAiMasterLinkedDocxReviewRequest.js'
import * as reviewRequestBuilders from './openAiMasterLinkedDocxReviewRequest.js'
import { G1_FIXED, G1_MODES, G1_STATUSES, G1_CORRECTED_QA_RELEASE, g1ReleaseProfile, assertG1CorrectedSubject,
  G1_APPROVED_GENUINE_RELEASE, G1_APPROVED_DIAGNOSTIC_GENUINE_RELEASE, G1_NARROW_GENUINE_RELEASE,
  assertG1ApprovedSubject, assertG1NarrowSubject, g1RequestProfile,
  assertG1FixedSubject, assertG1CategoryQaSubject, assertG1Approval, assertG1QaRelease, g1SubjectRoot, g1Key } from './masterLinkedGenuineReviewContract.js'
import { authenticateMasterReviewNativeOperator, MASTER_REVIEW_DATABASE, releaseNeed as need } from './masterLinkedReviewOperatorAuthority.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { APPROVED_DOCX_OPERATION_LIMITS } from './approvedDocxReadProfile.js'

const same = (a, b) => membershipHash(a) === membershipHash(b)
const raw = value => value?.toObject ? value.toObject() : value
const verify = audit => Audit.prototype.verifySignature.call(audit)
const metadata = audit => ({ approvalAuditId: String(audit._id), issuedAt: audit.diff.issuedAt, expiresAt: audit.diff.expiresAt,
  operatorAuthority: audit.diff.operatorAuthority, dispatchAvailable: false, approvalAvailable: false, finalisationAvailable: false })

// Repeatable internal application entry point for the controlled review worker.
// Issuance neither reserves an attempt nor constructs a provider capability.
// No dependency overrides, account provisioning or customer HTTP route here.
const issue = async (args, qa, correction = false, category = false, approved = false, diagnostic = false) => {
  const narrow = approved === 'NARROW'
  need(!narrow || !qa && !diagnostic, 'NARROW_GENUINE_PROFILE_REQUIRED')
  need(!category || correction, 'CATEGORY_CORRECTION_REQUIRED')
  need(!approved || correction && category, 'APPROVED_GENUINE_PROFILE_REQUIRED')
  need(!diagnostic || approved && !qa, 'DIAGNOSTIC_GENUINE_PROFILE_REQUIRED')
  need(args && Object.keys(args).sort().join(',') === (qa ? 'approvalReference,authorization,expected,qaCase' : 'approvalReference,authorization,expected'), 'RELEASE_INPUT')
  need(!approved || approved === g1RequestProfile(args.expected), 'RELEASE_REQUEST_CHANGED')
  need(!qa || typeof args.qaCase === 'string' && /^ss055-release-proof-[a-z0-9-]{1,42}$/.test(args.qaCase), 'QA_RELEASE_CASE')
  need(typeof args.approvalReference === 'string' && args.approvalReference.trim().length > 0 && args.approvalReference.length <= 500, 'APPROVAL_REFERENCE_REQUIRED')
  need(Audit.db === User.db && Audit.db === Execution.db && Audit.db.name === MASTER_REVIEW_DATABASE, 'RELEASE_DATABASE_OWNER')
  const deadline = Date.now() + (approved ? APPROVED_DOCX_OPERATION_LIMITS.APPROVED_REVIEW_PREPARATION.deadlineMs : 900000)
  const before = await authenticateMasterReviewNativeOperator(args.authorization)
  const actor = await User.findById(G1_FIXED.actorUserId).maxTimeMS(3000).lean()
  need(actor?.isActive === true, 'APP_ACTOR_INACTIVE')
  const permissions = await buildUserPermissionsSnapshot(actor)
  // Select the fixed review context without granting access to it. The source
  // transport still checks the actor's current permissions and exact lineage.
  const scopes = { ...permissions,
    customer: { ...permissions.customer, _id: G1_FIXED.customerId },
    tenant: { ...permissions.tenant, _id: G1_FIXED.tenantId, customerId: G1_FIXED.customerId } }
  const candidateId = narrow ? G1_NARROW_GENUINE_RELEASE.candidateId : approved ? G1_APPROVED_GENUINE_RELEASE.candidateId : correction ? G1_CORRECTED_QA_RELEASE.candidateId : G1_FIXED.candidateId
  const transport = await (narrow ? prepareNarrowMasterLinkedDocxReviewTransport : approved ? prepareApprovedMasterLinkedDocxReviewTransport : prepareMasterLinkedDocxReviewTransport)({ actorUserId: G1_FIXED.actorUserId, scopes,
    candidateId, runtimeInstanceId: G1_FIXED.runtimeInstanceId })
  const prepared = narrow ? reviewRequestBuilders.buildOpenAiNarrowMasterLinkedCategoryDocxReviewRequest(transport)
    : approved ? reviewRequestBuilders.buildOpenAiApprovedMasterLinkedCategoryDocxReviewRequest(transport)
    : category ? reviewRequestBuilders.buildOpenAiMasterLinkedCategoryDocxReviewRequest(transport) : buildOpenAiMasterLinkedDocxReviewRequest(transport)
  if (narrow) assertG1NarrowSubject(transport.subject, prepared.binding)
  else if (approved) assertG1ApprovedSubject(transport.subject, prepared.binding)
  else if (category) assertG1CategoryQaSubject(transport.subject, prepared.binding)
  else if (correction) assertG1CorrectedSubject(transport.subject, prepared.binding)
  else assertG1FixedSubject(transport.subject, prepared.binding)
  need(same(args.expected, prepared.binding), 'RELEASE_REQUEST_CHANGED')
  const operator = await authenticateMasterReviewNativeOperator(args.authorization)
  need(same(before, operator) && Date.now() < deadline, 'OPERATOR_CHANGED')
  const releaseVersion = diagnostic ? G1_APPROVED_DIAGNOSTIC_GENUINE_RELEASE.version : null
  const profile = g1ReleaseProfile(transport.subject, qa ? G1_MODES.QA : G1_MODES.GENUINE, prepared.binding, releaseVersion), scope = transport.subject.binding.masterReference.scope
  const root = g1SubjectRoot(transport.subject, prepared.binding, qa ? G1_MODES.QA : G1_MODES.GENUINE, qa ? args.qaCase : '', releaseVersion)
  const check = (audit, now) => qa ? assertG1QaRelease(audit, transport.subject, prepared.binding, verify, now, args.qaCase)
    : assertG1Approval(audit, transport.subject, prepared.binding, verify, now)
  // Genuine/legacy identities are unchanged; corrected QA has its own frozen
  // subject root and cannot renew either historical release.
  const id = createHash('sha256').update((narrow ? 'SS055_NARROW_GENUINE_RELEASE:' : diagnostic ? 'SS055_DIAGNOSTIC_GENUINE_RELEASE:' : approved ? qa ? 'SS055_APPROVED_NETWORK_QA_RELEASE:' : 'SS055_APPROVED_GENUINE_RELEASE:' : category ? qa ? 'SS055_CATEGORY_NETWORK_QA_RELEASE:' : 'SS055_CATEGORY_GENUINE_RELEASE:' : correction ? qa ? 'SS055_CORRECTED_NETWORK_QA_RELEASE:' : 'SS055_CORRECTED_GENUINE_RELEASE:'
    : qa ? 'SS055_NETWORK_QA_RELEASE:' : 'SS055_CONTROLLED_REVIEW_RELEASE:') + root).digest('hex').slice(0, 24)
  const session = await Audit.db.startSession()
  let saved, callbacks = 0
  try {
    await session.withTransaction(async () => {
      need(++callbacks <= 2 && Date.now() < deadline, 'RELEASE_DEADLINE')
      const existing = await Audit.findById(id).session(session).lean()
      if (existing) {
        const d = check(existing, Date.now())
        need(d.version === profile.version && same(d.operatorAuthority, operator)
          && d.approvalReference === args.approvalReference, 'RELEASE_CONFLICT')
        saved = existing; return
      }
      const occupied = await Execution.findOne({ tenantId: scope.tenantId, customerId: scope.customerId,
        idempotencyKey: { $in: Object.keys(G1_STATUSES).map(phase => g1Key(root, phase)) } }).session(session).lean()
      need(!occupied, 'GENUINE_ATTEMPT_ALREADY_RESERVED')
      const now = Date.now()
      const diff = { version: profile.version, approvingOperatorUserId: operator.operatorUserId,
        operatorAuthority: operator, appActorUserId: G1_FIXED.actorUserId, onceRoot: root, scope,
        candidateId, masterId: G1_FIXED.masterId, requestBinding: prepared.binding,
        legacyReconciliationFingerprint: G1_FIXED.reconciliation, approvalReference: args.approvalReference,
        issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 1800000).toISOString(),
        permittedUse: 'CONTROLLED_DEVELOPMENT_TEST_ONLY', maximumAttempts: 1,
        customerApproval: false, productionUse: false, automaticFinalisation: false,
        ...(qa ? { qaCase: args.qaCase, genuineReviewEligible: false } : {}) }
      const pending = raw(await auditService.log({ _id: id, actorUserId: operator.operatorUserId,
        action: profile.action, resourceType: 'RuntimeInstance', resourceId: scope.runtimeInstanceId,
        scope, diff, signatureVersion: 3 }, { session, throwOnError: true }))
      check(pending, Date.now())
      saved = pending
    }, { timeoutMS: 20000, maxCommitTimeMS: 10000 })
  } finally { await session.endSession() }
  need(Date.now() < deadline, 'RELEASE_DEADLINE')
  const readback = await Audit.findById(id).maxTimeMS(Math.min(3000, deadline - Date.now())).lean()
  need(Date.now() < deadline, 'RELEASE_DEADLINE')
  check(readback, Date.now())
  need(same(raw(readback), raw(saved)), 'RELEASE_READBACK_MISMATCH')
  return { ...metadata(readback), ...(qa ? { mode: G1_MODES.QA, genuineReviewEligible: false } : {}) }
}
export const issueMasterLinkedReviewRelease = args => issue(args, false)
export const issueNetworkQaMasterLinkedReviewRelease = args => issue(args, true)
export const issueCorrectedNetworkQaMasterLinkedReviewRelease = args => issue(args, true, true)
export const issueCorrectedMasterLinkedReviewRelease = args => issue(args, false, true)
export const issueCategoryNetworkQaMasterLinkedReviewRelease = args => issue(args, true, true, true)
export const issueCategoryGenuineMasterLinkedReviewRelease = args => issue(args, false, true, true)
export const issueApprovedGenuineMasterLinkedReviewRelease = args => issue(args, false, true, true, true)
export const issueApprovedNetworkQaMasterLinkedReviewRelease = args => issue(args, true, true, true, true)
export const issueDiagnosticGenuineMasterLinkedReviewRelease = args => issue(args, false, true, true, true, true)
export const issueNarrowGenuineMasterLinkedReviewRelease = args => issue(args, false, true, true, 'NARROW')
