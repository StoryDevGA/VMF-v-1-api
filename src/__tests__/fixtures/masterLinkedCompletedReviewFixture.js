import Audit from '../../models/AuditLog.js'
import { masterLinkedReviewSimulationFixture } from './masterLinkedReviewSimulationFixture.js'
import { meaningMasterAuditDiff } from '../../services/outcomeMeaningSourceMasterContract.js'

// Locally signed in-memory source rows for storage mechanics only. No native
// admission, customer authority or source record insertion is supplied here.
export const masterLinkedCompletedReviewFixture = async () => {
  const f = await masterLinkedReviewSimulationFixture(), master = f.masterRecord
  const masterAudit = new Audit({ _id: master.auditId, signatureVersion: master.auditSignatureVersion, actorUserId: f.actorUserId,
    action: 'OUTCOME_MEANING_SOURCE_RECORDED', resourceType: 'OutcomeMeaningSourceMaster', resourceId: master._id,
    scope: f.scope, diff: meaningMasterAuditDiff(master) })
  masterAudit.generateSignature()
  const sources = { master, candidate: f.record, preview: f.preview, plan: f.plan,
    audits: { master: masterAudit.toObject(), candidate: f.audit, preview: f.previewAudit } }
  const { executionMode: _mode, deps, ...args } = f.args
  return { ...f, sources, authorityDeps: deps, args: { ...args, qaCase: 'g2-unit' },
    storageSourceDeps: { readSourceRecords: async () => sources, assertPlanIntegrity: () => {} } }
}
