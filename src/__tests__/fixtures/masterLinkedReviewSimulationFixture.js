import { masterLinkedDocxFixture } from './masterLinkedDocxFixture.js'
import { renditionReviewClaimFixture } from './renditionReviewClaimFixture.js'
import { prepareMasterLinkedDocxReviewTransport } from '../../services/outcomeMasterLinkedDocxReviewTransportService.js'
import { buildOpenAiMasterLinkedDocxReviewRequest } from '../../services/openAiMasterLinkedDocxReviewRequest.js'
import { membershipHash } from '../../services/runtimeEvidenceSnapshotContract.js'

const copy = value => JSON.parse(JSON.stringify(value))
// Unsigned source/runtime seams, never native source or genuine review evidence.
// The persistence proof separately uses actual default owners for its real input.
export const masterLinkedReviewSimulationFixture = async runtimeId => {
  const f = await masterLinkedDocxFixture(runtimeId), m = renditionReviewClaimFixture(), body = f.record.body
  const candidate = { ...copy(body), bodyFingerprint: f.record.bodyFingerprint, renderer: body.input.renderer,
    masterBindingFingerprint: membershipHash(body.masterBinding) }
  const observed = { candidate, buffer: Buffer.from(f.record.fileBytes), candidateInput: copy(body.input), scope: f.scope }
  const ref = f.envelope.source.plan, plan = { ...copy(m.plan), ...f.scope, _id: ref.recordId,
    ...Object.fromEntries(['planId', 'requestId', 'planFingerprint', 'resolutionFingerprint', 'contextFingerprint'].map(key => [key, ref[key]])) }
  const request = { actorUserId: f.actorUserId, runtimeInstanceId: f.scope.runtimeInstanceId, candidateId: body.candidateId,
    scopes: { selectedCustomerId: f.scope.customerId }, deps: { readCandidate: async () => observed, readMaster: async () => copy(f.masterReceipt),
      readPreview: async () => ({ preview: copy(f.preview.body), pages: f.preview.pageBytes.map(page => Buffer.from(page)) }),
      loadPlan: async () => plan, assertPlanIntegrity: () => {}, loadPackContent: async query => query.packId === m.methodPack.packId
        ? { ...m.methodPack, available: true, content: m.methodContent } : f.loadPackContent(query) } }
  const transport = await prepareMasterLinkedDocxReviewTransport(request), expected = buildOpenAiMasterLinkedDocxReviewRequest(transport).binding
  const runtime = { _id: f.scope.runtimeInstanceId, ...f.scope, runtimeInstanceKey: 'controlled-master-review-fixture', runtimeType: 'VMF',
    frameworkKey: 'VMF', packageKey: 'synthetic-test', packageVersion: '1.0.0', status: 'LOCKED' }
  return { ...f, plan, transport, runtime, args: { actorUserId: f.actorUserId, runtimeInstanceId: f.scope.runtimeInstanceId,
    candidateId: body.candidateId, scopes: request.scopes, executionMode: 'SIMULATED', expected,
    deps: { prepareTransport: async () => ({ ...copy({ ...transport, pages: [] }), pages: transport.pages.map(page => Buffer.from(page)) }),
      assertPermission: async () => {}, readRuntime: async () => copy(runtime) } } }
}
