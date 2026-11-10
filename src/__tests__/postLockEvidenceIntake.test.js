import { describe, test, expect, jest } from '@jest/globals'
import mongoose from 'mongoose'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import RuntimeStateSection from '../models/RuntimeStateSection.js'
import RuntimeInstance from '../models/RuntimeInstance.js'
import AuditLog from '../models/AuditLog.js'
import { discoveryPolicySnapshot } from '../services/discoveryPolicyContract.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { POST_LOCK_RECORDING_REFERENCE, POST_LOCK_HUMAN_IMPACT_REFERENCE, POST_LOCK_ADMISSION_REFERENCE, POST_LOCK_ASSOCIATION_VERSION, parsePostLockSubmission,
  postLockSubmissionId, postLockRequestDigest, postLockSourceHash, postLockSnapshotPointer, validPostLockRow,
  assertPostLockRecordingBinding } from '../services/postLockEvidenceIntakeContract.js'
import { POST_LOCK_DISCOVERY_DISPOSITIONS } from '../services/discoveryContractReadinessService.js'
import { POST_LOCK_IMPACT_VERSION, POST_LOCK_IMPACT_HISTORY_VERSION, parsePostLockImpactRequest,
  postLockImpactPayloadHash, postLockImpactDecisionId, postLockImpactDecisionHash,
  assertPostLockImpactHistory, validPostLockImpactHistoryRow, publicPostLockImpactEntry } from '../services/postLockImpactDecisionContract.js'
import { postLockImpactRequestFromEntry } from '../services/postLockImpactDecisionContract.js'
import { POST_LOCK_ADMISSION_VERSION, POST_LOCK_ORIGIN_VERSION, parsePostLockAdmissionRequest,
  postLockAdmissionId, postLockAdmissionPayloadHash, parsePostLockSuccessorOrigin,
  buildPostLockSuccessorCandidatePlan } from '../services/postLockSuccessorAdmissionContract.js'
import { parsePostLockAdmissionReceipt, postLockRevisionAdmissionOperationHash, projectPostLockOrigin,
  assertPostLockOriginPairs, validPostLockAdmissionRow, validPostLockRevisionAdmission,
  assertPostLockAdmissionReceiptOrigin } from '../services/postLockSuccessorAdmissionContract.js'
import { normalizeDiscoveryEvidenceObjects, buildDiscoverySourceRegistry } from '../services/discoveryIntelligenceService.js'
import { createRuntimeStateLegacySourceRowSet } from '../services/runtimeStateLegacyMapper.js'
import { buildRuntimeSectionEvidenceQualifications } from '../services/runtimeSectionEvidenceQualificationService.js'
import { POST_LOCK_READ_STATE_VERSION, READ_STATE_MAX_BYTES, READ_RESPONSE_MAX_BYTES, READ_AUDIT_MAX_BYTES,
  createPostLockReadBudget, parsePostLockEvidenceReadState, assertPostLockReadResponseEnvelope,
  normalizePostLockReadStateError } from '../services/postLockEvidenceReadStateService.js'
import { buildCanonicalJson } from '../services/governanceAudit/checksumService.js'
import { parsePostLockOriginalPair, assertPostLockOriginalPairBinding, verifyPostLockOriginalReceipt } from '../services/postLockEvidenceIntakeService.js'
import { POST_LOCK_EVIDENCE_LIST_VERSION, LIST_MATERIAL_MAX_BYTES, LIST_RESPONSE_MAX_BYTES,
  parsePostLockEvidenceListQuery, encodePostLockEvidenceListCursor, parsePostLockEvidenceListCursor,
  buildPostLockEvidenceListBasis, projectPostLockEvidenceList, assertPostLockEvidenceListMaterialSize,
  assertPostLockEvidenceListResponseEnvelope, postLockEvidenceListError, isPostLockEvidenceListError } from '../services/postLockEvidenceListContract.js'
import { normalizePostLockEvidenceListError } from '../services/postLockEvidenceListService.js'

const oid = n => String(n).padStart(24, '0')
const withFixturePolicy = work => {
  const previous = process.env.VMF_POST_LOCK_FIXTURE_POLICY
  process.env.VMF_POST_LOCK_FIXTURE_POLICY = '1'
  try { return work() }
  finally {
    if (previous === undefined) delete process.env.VMF_POST_LOCK_FIXTURE_POLICY
    else process.env.VMF_POST_LOCK_FIXTURE_POLICY = previous
  }
}

describe('post-lock publication remains blocked pending SS-050 readiness', () => {
  const policyFixture = count => {
    const policy = { contractVersion: 'framework-package-discovery-policy-v1', policyKey: 'pending', policyVersion: '1.0',
      postLockDiscoveryPolicy: { enabled: true, mutateLockedRevision: false,
        references: [POST_LOCK_RECORDING_REFERENCE, POST_LOCK_HUMAN_IMPACT_REFERENCE, POST_LOCK_ADMISSION_REFERENCE].slice(0, count),
        ...(count > 1 ? { allowedDispositions: Object.values(POST_LOCK_DISCOVERY_DISPOSITIONS) } : {}) } }
    const runtime = { packageId: oid(104), frameworkKey: 'SS056_SYNTHETIC', packageKey: 'post-lock-contract-proof',
      packageVersion: '1.0', dependencyLockId: 'dependency', evidence: { dependencySnapshotHash: 'f'.repeat(64) } }
    return { runtime, frameworkPackage: { _id: runtime.packageId, frameworkKey: runtime.frameworkKey,
      packageKey: runtime.packageKey, version: '1.0', discoveryPolicy: policy,
      dependencyLock: { ...discoveryPolicySnapshot(policy), snapshotId: 'dependency', snapshotHash: 'f'.repeat(64) } } }
  }
  const deny = (input, operation) => expect(() => assertPostLockRecordingBinding({ ...input, operation }))
    .toThrow(expect.objectContaining({ status: 409, details: { reason: operation === 'recording' ? 'POST_LOCK_POLICY_UNAVAILABLE'
      : operation === 'impact' ? 'POST_LOCK_IMPACT_POLICY_UNAVAILABLE' : 'POST_LOCK_ADMISSION_POLICY_UNAVAILABLE' } }))
  test.each([1, 2, 3])('legacy %d-reference policy cannot enable any production operation by default', count => {
    const previous = process.env.VMF_POST_LOCK_FIXTURE_POLICY
    delete process.env.VMF_POST_LOCK_FIXTURE_POLICY
    try { for (const operation of ['recording', 'impact', 'admission']) deny(policyFixture(count), operation) }
    finally { if (previous !== undefined) process.env.VMF_POST_LOCK_FIXTURE_POLICY = previous }
  })
  test.each(['production', 'wrong-package', 'wrong-runtime', 'wrong-host', 'wrong-database', 'connecting'])('fixture flag refuses %s context', fault => withFixturePolicy(() => {
    const input = policyFixture(3), environment = process.env.NODE_ENV
    const descriptors = Object.fromEntries(['readyState', 'host', 'name'].map(key => [key, Object.getOwnPropertyDescriptor(mongoose.connection, key)]))
    try {
      if (fault === 'production') process.env.NODE_ENV = 'production'
      if (fault === 'wrong-package') input.frameworkPackage.packageKey = input.runtime.packageKey = 'native-package'
      if (fault === 'wrong-runtime') input.runtime.frameworkKey = 'VMF'
      if (['wrong-host', 'wrong-database', 'connecting'].includes(fault)) {
        for (const [key, value] of Object.entries({ readyState: fault === 'connecting' ? 2 : 1,
          host: fault === 'wrong-host' ? 'native.example' : '127.0.0.1',
          name: fault === 'wrong-database' ? 'test' : 'ss056_post_lock_intake' })) {
          Object.defineProperty(mongoose.connection, key, { configurable: true, value })
        }
      }
      for (const operation of ['recording', 'impact', 'admission']) deny(input, operation)
    } finally {
      if (environment === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = environment
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (descriptor) Object.defineProperty(mongoose.connection, key, descriptor)
        else delete mongoose.connection[key]
      }
    }
  }))
})

describe('ordinary successor refresh retains admitted material', () => {
  const packFor = (sourceType = 'MANUAL_DOCUMENT', reviewStatus = 'PENDING', requestKey) => {
    const plan = buildPostLockSuccessorCandidatePlan(candidateArgs(payload => {
      payload.source.sourceType = sourceType
      if (requestKey) payload.requestKey = requestKey
    }))
    const sources = [plan.source]
    const evidenceObjects = normalizeDiscoveryEvidenceObjects({ acquisitionProfile: 'STANDARD', createdAt: '2026-11-06T12:03:00.000Z', sources, sourceRegistry: sources,
      evidenceObjects: [{ ...plan.evidence, reviewStatus, auditRef: 'synthetic-review', auditRefs: ['synthetic-review'] }] })
    return { lineage: { sources }, evidenceObjects,
      sourceRegistry: buildDiscoverySourceRegistry({ sources, sourceRegistry: sources, evidenceObjects }),
      accepted: false, evidenceReady: false, needsRefresh: true }
  }
  const withRefresh = async work => {
    const FrameworkPackage = (await import('../models/FrameworkPackage.js')).default
    const { buildDiscoveryEvidencePack } = await import('../services/runtimeStateMutationService.js')
    const read = jest.spyOn(FrameworkPackage, 'findById').mockResolvedValue(null)
    const connect = jest.spyOn(mongoose, 'connect').mockImplementation(() => { throw new Error('UNEXPECTED_DATABASE_CONNECTION') })
    const network = jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('UNEXPECTED_NETWORK_CALL') })
    try {
      await work(previousEvidencePack => buildDiscoveryEvidencePack({ acquisitionProfile: 'STANDARD', actorUserId: oid(109),
        runtimeInstance: {}, previousEvidencePack,
        inputs: { companyName: 'Synthetic', marketRegion: 'Synthetic', targetOffer: 'Synthetic', companyWebsite: '', notes: '' } }))
      expect(connect).not.toHaveBeenCalled()
      expect(network).not.toHaveBeenCalled()
    } finally { read.mockRestore(); connect.mockRestore(); network.mockRestore() }
  }
  test.each(['MANUAL_DOCUMENT', 'PUBLIC_RESEARCH', 'WEBSITE', 'UPLOADED_DOCUMENT'].flatMap(type =>
    ['PENDING', 'ACCEPTED', 'REJECTED'].map(status => [type, status])))('%s retains %s across repeated refresh', async (type, status) => {
    await withRefresh(async refresh => {
      const previous = packFor(type, status), before = JSON.stringify(previous)
      const original = previous.evidenceObjects[0], source = previous.sourceRegistry[0]
      const once = await refresh(previous), twice = await refresh(once)
      for (const next of [once, twice]) {
        expect(next.evidenceObjects.filter(row => row.evidenceObjectId === original.evidenceObjectId)).toEqual([original])
        expect(next.sourceRegistry.filter(row => row.sourceId === source.sourceId)).toEqual([source])
        expect(next.lineage.sources.filter(row => row.sourceId === source.sourceId)).toEqual(previous.lineage.sources)
        expect(next.evidenceReady).toBe(false)
        expect(next.accepted).toBe(false)
      }
      expect(JSON.stringify(previous)).toBe(before)
    })
  })
  test.each(['null-origin', 'missing-registry', 'missing-lineage', 'missing-evidence', 'mismatched-lineage',
    'duplicate-source', 'duplicate-evidence', 'evidence-id-collision'])('fails closed for %s', async fault => {
    await withRefresh(async refresh => {
      const pack = packFor()
      if (fault === 'null-origin') pack.evidenceObjects[0].postLockOrigin = null
      if (fault === 'missing-registry') pack.sourceRegistry = []
      if (fault === 'missing-lineage') pack.lineage.sources = []
      if (fault === 'missing-evidence') pack.evidenceObjects = []
      if (fault === 'mismatched-lineage') pack.lineage.sources[0].postLockOrigin = null
      if (fault === 'duplicate-source') pack.sourceRegistry.push(structuredClone(pack.sourceRegistry[0]))
      if (fault === 'duplicate-evidence') pack.evidenceObjects.push(structuredClone(pack.evidenceObjects[0]))
      if (fault === 'evidence-id-collision') {
        const other = { ...pack.evidenceObjects[0], sourceId: 'unrelated-source' }
        delete other.postLockOrigin
        pack.evidenceObjects.push(other)
      }
      await expect(refresh(pack)).rejects.toMatchObject({ details: { reason: 'POST_LOCK_ADMISSION_MATERIAL_INVALID' } })
    })
  })
  test('retains multiple admitted pairs exactly once', async () => {
    await withRefresh(async refresh => {
      const first = packFor(), second = packFor('PUBLIC_RESEARCH', 'PENDING', '123e4567-e89b-42d3-a456-426614174009')
      const pack = { ...first, evidenceObjects: [...first.evidenceObjects, ...second.evidenceObjects],
        sourceRegistry: [...first.sourceRegistry, ...second.sourceRegistry],
        lineage: { sources: [...first.lineage.sources, ...second.lineage.sources] } }
      const next = await refresh(pack)
      for (const original of pack.evidenceObjects) expect(next.evidenceObjects.filter(row => row.evidenceObjectId === original.evidenceObjectId)).toEqual([original])
    })
  })
})
const fixture = () => ({ contractVersion: 'post-lock-evidence-submission.v1',
  requestKey: '123e4567-e89b-42d3-a456-426614174001',
  binding: { customerId: oid(102), tenantId: oid(103), runtimeInstanceId: oid(101), runtimeInstanceKey: 'ss056-pending-synthetic',
    revisionNumber: 1, basisStateVersion: 'rsv2:123e4567-e89b-42d3-a456-426614174000',
    evidenceSnapshotId: 'evidence_snapshot_123e4567-e89b-42d3-a456-426614174002', membershipHash: 'a'.repeat(64),
    lockSnapshotId: 'synthetic-lock', lockSnapshotHash: 'b'.repeat(64), packageId: oid(104), packageVersion: '1.0',
    dependencySnapshotId: 'synthetic-dependency', dependencySnapshotHash: 'c'.repeat(64), policyHash: 'd'.repeat(64) },
  source: { sourceId: 'manual-document-1', sourceType: 'MANUAL_DOCUMENT', title: 'Synthetic source',
    locator: { passage: 'Synthetic supplied passage.' }, contentHash: `sha256:${'e'.repeat(64)}`,
    retrievedAt: '2026-11-06T12:00:00.000Z', currentness: 'UNCONFIRMED', qualifications: ['Not independently verified.'],
    licensing: { licenceRef: 'synthetic-owner-permission', retentionPermitted: true, retainUntil: null },
    provenance: { producerKey: 'manual', producerVersion: '1', receiptRef: 'fixture-receipt-1', acquiredAt: '2026-11-06T12:00:00.000Z' } },
  evidence: { title: 'Synthetic evidence', statement: 'A new synthetic fact awaiting review.', sectionKeys: [] },
  reason: 'Check whether this changes the next revision.',
})

const impactRequest = (row, index = 1, head = null) => ({ contractVersion: POST_LOCK_IMPACT_VERSION,
  requestKey: `123e4567-e89b-42d3-a456-${String(index).padStart(12, '0')}`, expectedBinding: row.postLockAssociation.binding,
  expectedSubmissionDigest: row.postLockAssociation.requestDigest, expectedHeadHash: head,
  disposition: 'SUCCESSOR_REVISION_REQUIRED', rationale: 'A human conclusion; no acceptance or automatic successor.', confirm: true })
const impactHistory = (row, count = 1, rationale = 'A recorded human conclusion.') => {
  const entries = []
  for (let index = 1; index <= count; index++) {
    const prior = entries.at(-1)?.decisionHash || null, request = { ...impactRequest(row, index, prior), rationale }
    const material = { contractVersion: POST_LOCK_IMPACT_VERSION,
      decisionId: postLockImpactDecisionId(row.postLockAssociation.submissionId, request.requestKey),
      payloadHash: postLockImpactPayloadHash(request, oid(109), row.postLockAssociation.submissionId), requestKey: request.requestKey,
      sequence: index, submissionId: row.postLockAssociation.submissionId, submissionRequestDigest: row.postLockAssociation.requestDigest,
      binding: request.expectedBinding, reviewerUserId: oid(109), authority: 'VMF_UPDATE', disposition: request.disposition,
      rationale, decidedAt: '2026-11-06T12:02:00.000Z', previousDecisionHash: prior }
    entries.push({ ...material, decisionHash: postLockImpactDecisionHash(material), auditId: oid(130 + index), auditSignatureVersion: 2 })
  }
  return { contractVersion: POST_LOCK_IMPACT_HISTORY_VERSION, entries, headHash: entries.at(-1)?.decisionHash }
}
describe('human post-lock impact request and retained material', () => {
  test.each(Object.values(POST_LOCK_DISCOVERY_DISPOSITIONS))('accepts confirmed %s without admission authority', disposition => {
    const input = { ...impactRequest(rows().evidence), disposition }
    expect(parsePostLockImpactRequest(input).disposition).toBe(disposition)
  })
  test.each(['rationale', 'blank', 'confirm', 'disposition', 'extra', 'head', 'binding', 'oversized'])('rejects %s decision request with a specific validation reason', fault => {
    const input = JSON.parse(JSON.stringify(impactRequest(rows().evidence)))
    if (fault === 'rationale') delete input.rationale
    if (fault === 'blank') input.rationale = '  '
    if (fault === 'confirm') input.confirm = false
    if (fault === 'disposition') input.disposition = 'ACCEPTED'
    if (fault === 'extra') input.reviewerUserId = oid(999)
    if (fault === 'head') input.expectedHeadHash = 'unknown'
    if (fault === 'binding') input.expectedBinding.override = true
    if (fault === 'oversized') input.rationale = 'r'.repeat(2001)
    expect(() => parsePostLockImpactRequest(input)).toThrow(expect.objectContaining({
      status: 422, details: { reason: 'POST_LOCK_IMPACT_REQUEST_INVALID' },
    }))
  })
  test('retains an exact chain on the pending Evidence Object without changing acceptance or migration rules', async () => {
    const row = rows().evidence; row.postLockImpactHistory = impactHistory(row, 2)
    expect(validPostLockImpactHistoryRow(row)).toBe(true)
    await expect(new RuntimeEvidenceObject(row).validate()).resolves.toBeUndefined()
    expect(row.current).toBe(false); expect(row.acceptanceState).toBe('POST_LOCK_PENDING')
    expect(row.migrationReceiptId).toBeUndefined()
    const old = publicPostLockImpactEntry(row.postLockImpactHistory.entries[0], true, row.postLockImpactHistory.headHash)
    expect(old).toMatchObject({ verified: true, isCurrent: false })
    const unverified = publicPostLockImpactEntry(row.postLockImpactHistory.entries[1], false, null)
    expect(unverified).toMatchObject({ verified: false, isCurrent: false })
  })
  test.each(['head', 'previous', 'sequence', 'submission', 'digest', 'binding', 'rationale', 'duplicate', 'extra', 'null', 'empty'])('rejects malformed %s history instead of projecting empty or current', fault => {
    const row = rows().evidence, history = impactHistory(row, 2)
    if (fault === 'head') history.headHash = '0'.repeat(64)
    if (fault === 'previous') history.entries[1].previousDecisionHash = null
    if (fault === 'sequence') history.entries[1].sequence = 1
    if (fault === 'submission') history.entries[0].submissionId = '0'.repeat(64)
    if (fault === 'digest') history.entries[0].submissionRequestDigest = '0'.repeat(64)
    if (fault === 'binding') history.entries[0].binding = { ...history.entries[0].binding, tenantId: oid(999) }
    if (fault === 'rationale') history.entries[0].rationale = 'Changed without resealing.'
    if (fault === 'duplicate') history.entries[1].requestKey = history.entries[0].requestKey
    if (fault === 'extra') history.approved = true
    if (fault === 'empty') history.entries = []
    expect(() => assertPostLockImpactHistory(fault === 'null' ? null : history, row.postLockAssociation))
      .toThrow(expect.objectContaining({ status: 503, details: { reason: 'POST_LOCK_IMPACT_HISTORY_INVALID' } }))
  })
  test('byte capacity rejects a large otherwise chained history without truncating its input', () => {
    const row = rows().evidence, history = impactHistory(row, 50, 'r'.repeat(2000))
    expect(() => assertPostLockImpactHistory(history, row.postLockAssociation)).toThrow()
    expect(history.entries).toHaveLength(50)
  })
  test('current and unrelated rows cannot carry impact history, and source schema refuses the field', async () => {
    const row = rows().evidence; row.postLockImpactHistory = impactHistory(row)
    for (const input of [{ ...row, current: true }, { ...row, postLockAssociation: undefined, migrationReceiptId: oid(105) }]) {
      expect(validPostLockImpactHistoryRow(input)).toBe(false)
      const result = new RuntimeEvidenceObject(input).validateSync()
      expect(result.errors.postLockImpactHistory).toBeDefined()
    }
    expect(() => new RuntimeEvidenceSource({ ...rows().source, postLockImpactHistory: row.postLockImpactHistory })).toThrow()
  })
  test('combined captured policy selects only the implemented human recorder; recording-only policy stays compatible', () => withFixturePolicy(() => {
    const runtime = { packageId: oid(104), frameworkKey: 'SS056_SYNTHETIC', packageKey: 'post-lock-contract-proof', packageVersion: '1.0',
      dependencyLockId: 'dependency', evidence: { dependencySnapshotHash: 'f'.repeat(64) } }
    const make = human => {
      const policy = { contractVersion: 'framework-package-discovery-policy-v1', policyKey: 'pending', policyVersion: '1.0',
        postLockDiscoveryPolicy: { enabled: true, mutateLockedRevision: false,
          references: [{ ...POST_LOCK_RECORDING_REFERENCE }, ...(human ? [{ ...POST_LOCK_HUMAN_IMPACT_REFERENCE }] : [])],
          ...(human ? { allowedDispositions: Object.values(POST_LOCK_DISCOVERY_DISPOSITIONS) } : {}) } }
      return { _id: runtime.packageId, frameworkKey: runtime.frameworkKey, packageKey: runtime.packageKey, version: '1.0',
        discoveryPolicy: policy, dependencyLock: { ...discoveryPolicySnapshot(policy), snapshotId: 'dependency', snapshotHash: 'f'.repeat(64) } }
    }
    expect(POST_LOCK_HUMAN_IMPACT_REFERENCE.resultType).toBe(POST_LOCK_IMPACT_VERSION)
    const recording = make(false), combined = make(true)
    expect(assertPostLockRecordingBinding({ frameworkPackage: recording, runtime })).toBe(recording.dependencyLock.discoveryPolicyHash)
    expect(() => assertPostLockRecordingBinding({ frameworkPackage: recording, runtime, operation: 'impact' })).toThrow()
    expect(assertPostLockRecordingBinding({ frameworkPackage: combined, runtime, operation: 'impact' })).toBe(combined.dependencyLock.discoveryPolicyHash)
    const altered = make(true); altered.discoveryPolicy.postLockDiscoveryPolicy.allowedDispositions.pop()
    expect(() => assertPostLockRecordingBinding({ frameworkPackage: altered, runtime, operation: 'impact' })).toThrow()
  }))
})
const rows = () => {
  const payload = parsePostLockSubmission(fixture()), submissionId = postLockSubmissionId(payload)
  const requestDigest = postLockRequestDigest(payload, oid(109))
  const association = { contractVersion: POST_LOCK_ASSOCIATION_VERSION, submissionId, requestKey: payload.requestKey,
    requestDigest, binding: payload.binding, submittedBy: oid(109), submittedAt: '2026-11-06T12:01:00.000Z',
    receiptId: oid(120), status: 'PENDING_REVIEW' }
  const common = { customerId: oid(102), tenantId: oid(103), runtimeInstanceId: oid(101), runtimeInstanceKey: payload.binding.runtimeInstanceKey,
    stateVersion: payload.binding.basisStateVersion, sourceStateVersion: payload.binding.basisStateVersion,
    sourceHash: postLockSourceHash(requestDigest), current: false, sourceId: `post-lock-source:${submissionId}`,
    sourceType: payload.source.sourceType, contentHash: payload.source.contentHash,
    lineageRef: payload.source.provenance.receiptRef, reviewStatus: 'PENDING_REVIEW' }
  return { payload, source: { ...common, title: payload.source.title, sourceRef: '', acquisitionStatus: 'POST_LOCK_PENDING',
    postLockAssociation: { ...association, source: payload.source } },
  evidence: { ...common, evidenceObjectId: `post-lock:${submissionId}`, title: payload.evidence.title,
    extractedFact: payload.evidence.statement, acceptanceState: 'POST_LOCK_PENDING',
    postLockAssociation: { ...association, evidence: payload.evidence, reason: payload.reason } } }
}
describe('source-neutral post-lock recording contract', () => {
  test('characterizes the native clone realm at the existing strict snapshot boundary', () => {
    const pointer = { snapshotId: fixture().binding.evidenceSnapshotId }
    const cloned = structuredClone(pointer)
    expect(Object.getPrototypeOf(cloned)).not.toBe(Object.prototype)
    expect(() => membershipHash(cloned)).toThrow(expect.objectContaining({ details: { reason: 'MATERIAL_PROTOTYPE' } }))
  })
  test('normalizes the pointer realm without dropping or evaluating unsafe descriptors', () => {
    const original = { snapshotId: fixture().binding.evidenceSnapshotId }
    expect(membershipHash(postLockSnapshotPointer(structuredClone(original)))).toBe(membershipHash(original))
    const extra = postLockSnapshotPointer({ ...original, unexpected: 'must remain visible' })
    expect(extra.unexpected).toBe('must remain visible')
    expect(membershipHash(extra)).not.toBe(membershipHash(original))
    let calls = 0
    const accessor = Object.defineProperty({ ...original }, 'unexpected', { enumerable: true, get() { calls++; return 'unsafe' } })
    const copied = postLockSnapshotPointer(accessor)
    expect(calls).toBe(0)
    expect(() => membershipHash(copied)).toThrow()
    expect(calls).toBe(0)
    const symbol = { ...original, [Symbol('unexpected')]: 'unsafe' }
    expect(Object.getOwnPropertySymbols(postLockSnapshotPointer(symbol))).toHaveLength(1)
    expect(() => membershipHash(postLockSnapshotPointer(symbol))).toThrow()
    const hidden = Object.defineProperty({ ...original }, 'unexpected', { value: 'hidden', enumerable: false })
    expect(() => membershipHash(postLockSnapshotPointer(hidden))).toThrow()
  })
  test('normalizes explicit text and preserves source qualifications and receipt fields', () => {
    const input = fixture(); input.reason = ` ${input.reason} `
    expect(parsePostLockSubmission(input)).toEqual(fixture())
  })
  test.each(['retrievedAt', 'asOfAt', 'acquiredAt', 'retainUntil'])('malformed %s returns validation422 rather than a date exception', field => {
    const input = fixture()
    if (field === 'acquiredAt') input.source.provenance.acquiredAt = 'not-a-date'
    else if (field === 'retainUntil') input.source.licensing.retainUntil = 'not-a-date'
    else {
      input.source[field] = 'not-a-date'
      if (field === 'asOfAt') input.source.currentness = 'AS_OF'
    }
    expect(() => parsePostLockSubmission(input)).toThrow(expect.objectContaining({
      status: 422, details: { reason: 'POST_LOCK_SUBMISSION_INVALID' },
    }))
  })
  test.each(['extra', 'source-extra', 'binding-extra', 'missing-hash', 'duplicate-section', 'currentness', 'url', 'oversized', 'date'])('rejects %s payload', kind => {
    const input = fixture()
    if (kind === 'extra') input.providerSecret = 'unknown'
    if (kind === 'source-extra') input.source.provider = 'unsupported'
    if (kind === 'binding-extra') input.binding.overrideLock = true
    if (kind === 'missing-hash') delete input.source.contentHash
    if (kind === 'duplicate-section') input.evidence.sectionKeys = ['a', 'a']
    if (kind === 'currentness') input.source.currentness = 'AS_OF'
    if (kind === 'url') input.source.locator = { url: 'file:///private' }
    if (kind === 'oversized') input.evidence.statement = 'x'.repeat(8001)
    if (kind === 'date') input.source.retrievedAt = '2026-11-06T12:00:00Z'
    expect(() => parsePostLockSubmission(input)).toThrow()
  })
  test('request identity is stable while every payload or actor change changes its digest', () => {
    const payload = fixture(), other = structuredClone(payload)
    other.source.qualifications.push('Currentness uncertain.')
    expect(postLockSubmissionId(other)).toBe(postLockSubmissionId(payload))
    expect(postLockRequestDigest(other, oid(109))).not.toBe(postLockRequestDigest(payload, oid(109)))
    expect(postLockRequestDigest(payload, oid(110))).not.toBe(postLockRequestDigest(payload, oid(109)))
    other.binding.tenantId = oid(999)
    expect(postLockSubmissionId(other)).not.toBe(postLockSubmissionId(payload))
  })
  test('receipt reference bounds match the existing source and evidence lineage fields', () => {
    const input = fixture(); input.source.provenance.receiptRef = 'r'.repeat(1000)
    expect(parsePostLockSubmission(input).source.provenance.receiptRef).toHaveLength(1000)
    input.source.provenance.receiptRef += 'r'
    expect(() => parsePostLockSubmission(input)).toThrow()
  })
  test.each(['https://user:secret@example.org/', 'http://user@example.org/'])('rejects credentials in %s', url => {
    const input = fixture(); input.source.locator = { url }
    expect(() => parsePostLockSubmission(input)).toThrow()
  })
  test.each(['isCurrent', 'status', 'stateStatus'])('raw %s aliases cannot verify as pending material', field => {
    for (const kind of ['source', 'evidence']) {
      const row = rows()[kind]; row[field] = field === 'isCurrent' ? true : 'CURRENT'
      expect(validPostLockRow(row, kind)).toBe(false)
    }
  })
  test.each(['source', 'evidence'])('valid %s row has its own signed receipt reference and no migration claim', async kind => {
    const row = rows()[kind], Model = kind === 'source' ? RuntimeEvidenceSource : RuntimeEvidenceObject
    expect(validPostLockRow(row, kind)).toBe(true)
    const model = new Model(row)
    await expect(model.validate()).resolves.toBeUndefined()
    expect(model.migrationReceiptId).toBeUndefined()
  })
  test.each(['current', 'scope', 'state', 'sourceHash', 'identity', 'receipt', 'migration', 'material', 'status', 'extra'])('invalid %s association cannot suppress required migration validation', async kind => {
    const row = rows().evidence
    if (kind === 'current') row.current = true
    if (kind === 'scope') row.tenantId = oid(999)
    if (kind === 'state') row.sourceStateVersion = 'rsv2:123e4567-e89b-42d3-a456-426614174009'
    if (kind === 'sourceHash') row.sourceHash = `sha256:${'f'.repeat(64)}`
    if (kind === 'identity') row.evidenceObjectId = 'original-frozen-id'
    if (kind === 'receipt') row.postLockAssociation.receiptId = 'not-an-objectid'
    if (kind === 'migration') row.migrationReceiptId = new mongoose.Types.ObjectId()
    if (kind === 'material') row.extractedFact = 'Changed without matching association.'
    if (kind === 'status') row.acceptanceState = 'ACCEPTED'
    if (kind === 'extra') row.postLockAssociation.allow = true
    expect(validPostLockRow(row, 'evidence')).toBe(false)
    await expect(new RuntimeEvidenceObject(row).validate()).rejects.toThrow()
  })
  test.each([['source', RuntimeEvidenceSource], ['evidence', RuntimeEvidenceObject], ['section', RuntimeStateSection]])('legacy %s still requires a migration receipt and emits no association', async (_kind, Model) => {
    const row = rows().evidence; delete row.postLockAssociation
    const input = { customerId: row.customerId, tenantId: row.tenantId, runtimeInstanceId: row.runtimeInstanceId,
      runtimeInstanceKey: row.runtimeInstanceKey, stateVersion: row.stateVersion, sourceStateVersion: row.sourceStateVersion,
      sourceHash: row.sourceHash, current: false,
      ...(Model === RuntimeEvidenceSource ? { sourceId: 'legacy', sourceType: 'DOCUMENT' }
        : Model === RuntimeEvidenceObject ? { evidenceObjectId: 'legacy', sourceId: 'legacy' } : { sectionKey: 'legacy' }) }
    const model = new Model(input)
    await expect(model.validate()).rejects.toThrow(/migrationReceiptId/)
    expect(Object.hasOwn(model.toObject(), 'postLockAssociation')).toBe(false)
  })
  test('only the exact captured application implementation binds; no VMF capability is invented', () => withFixturePolicy(() => {
    const runtime = { packageId: oid(104), frameworkKey: 'SS056_SYNTHETIC', packageKey: 'post-lock-contract-proof', packageVersion: '1.0',
      dependencyLockId: 'dependency', evidence: { dependencySnapshotHash: 'f'.repeat(64) } }
    const policy = { contractVersion: 'framework-package-discovery-policy-v1', policyKey: 'pending', policyVersion: '1.0',
      postLockDiscoveryPolicy: { enabled: true, mutateLockedRevision: false, references: [{ ...POST_LOCK_RECORDING_REFERENCE }] } }
    const pack = { _id: runtime.packageId, frameworkKey: runtime.frameworkKey, packageKey: runtime.packageKey, version: '1.0',
      discoveryPolicy: policy, dependencyLock: { ...discoveryPolicySnapshot(policy), snapshotId: 'dependency', snapshotHash: 'f'.repeat(64) } }
    expect(assertPostLockRecordingBinding({ frameworkPackage: pack, runtime })).toBe(pack.dependencyLock.discoveryPolicyHash)
    expect(POST_LOCK_RECORDING_REFERENCE).not.toHaveProperty('vmfCapabilityRef')
    for (const mutate of [
      p => { p.discoveryPolicy.postLockDiscoveryPolicy.enabled = false },
      p => { p.discoveryPolicy.postLockDiscoveryPolicy.references[0].vmfCapabilityRef = 'VE02' },
      p => { p.discoveryPolicy.postLockDiscoveryPolicy.references.push({ ...POST_LOCK_RECORDING_REFERENCE }) },
      p => { p.discoveryPolicy.postLockDiscoveryPolicy.references[0].restrictions = ['unimplemented'] },
      p => { p.dependencyLock.snapshotHash = 'e'.repeat(64) },
      p => { p.frameworkKey = 'different' },
    ]) {
      const altered = structuredClone(pack); mutate(altered)
      expect(() => assertPostLockRecordingBinding({ frameworkPackage: altered, runtime })).toThrow()
    }
  }))
})

const candidateArgs = (modify = () => {}) => {
  const pair = rows()
  modify(pair.payload)
  const payload = parsePostLockSubmission(pair.payload), submissionId = postLockSubmissionId(payload)
  const requestDigest = postLockRequestDigest(payload, oid(109)), sourceId = `post-lock-source:${submissionId}`
  for (const row of [pair.source, pair.evidence]) {
    Object.assign(row, { sourceId, sourceType: payload.source.sourceType, sourceHash: postLockSourceHash(requestDigest),
      contentHash: payload.source.contentHash, lineageRef: payload.source.provenance.receiptRef })
    Object.assign(row.postLockAssociation, { submissionId, requestDigest, requestKey: payload.requestKey, binding: payload.binding })
  }
  Object.assign(pair.source, { title: payload.source.title, sourceRef: payload.source.locator.url || '' })
  pair.source.postLockAssociation.source = payload.source
  Object.assign(pair.evidence, { evidenceObjectId: `post-lock:${submissionId}`, title: payload.evidence.title,
    extractedFact: payload.evidence.statement })
  Object.assign(pair.evidence.postLockAssociation, { evidence: payload.evidence, reason: payload.reason })
  pair.evidence.postLockImpactHistory = impactHistory(pair.evidence)
  return { request: { contractVersion: POST_LOCK_ADMISSION_VERSION,
    requestKey: '123e4567-e89b-42d3-a456-426614174500', submissionId, expectedSubmissionDigest: requestDigest,
    expectedBinding: payload.binding, expectedImpactHeadHash: pair.evidence.postLockImpactHistory.headHash,
    rationale: 'Explicitly carry this item into the new draft for normal review.', confirm: true },
    sourceRow: pair.source, evidenceRow: pair.evidence,
    target: { runtimeInstanceId: oid(202), runtimeInstanceKey: 'ss056-next-draft',
      stateVersion: 'rsv2:123e4567-e89b-42d3-a456-426614174501' },
    admission: { actorUserId: oid(109), admittedAt: '2026-11-06T12:03:00.000Z', auditId: oid(155), auditSignatureVersion: 2 } }
}
const admissionFailure = (work, reason, status) => expect(work).toThrow(expect.objectContaining({
  status, details: { reason: `POST_LOCK_ADMISSION_${reason}` },
}))

describe('explicit successor candidate material contract (no admission execution)', () => {
  test('preserves original metadata and inputs without inheriting acceptance or claiming authority', () => {
    const input = candidateArgs(payload => {
      payload.source.locator.url = 'https://example.org/report'
      payload.source.currentness = 'AS_OF'; payload.source.asOfAt = payload.source.retrievedAt
      payload.evidence.sectionKeys = ['company_context']
      payload.source.qualifications.push('Source identity is not an authenticity verdict.')
    })
    const before = JSON.stringify(input), plan = buildPostLockSuccessorCandidatePlan(input)
    expect(JSON.stringify(input)).toBe(before)
    expect(plan.source.postLockOrigin).toEqual(plan.evidence.postLockOrigin)
    expect(plan.source.postLockOrigin).not.toBe(plan.evidence.postLockOrigin)
    const origin = plan.source.postLockOrigin
    expect(origin.contractVersion).toBe(POST_LOCK_ORIGIN_VERSION)
    expect(origin.submission.source).toEqual(input.sourceRow.postLockAssociation.source)
    expect(origin.submission.evidence).toEqual(input.evidenceRow.postLockAssociation.evidence)
    expect(origin.impact).toEqual(input.evidenceRow.postLockImpactHistory.entries.at(-1))
    expect(origin.admission.target).toEqual(input.target)
    expect(parsePostLockSuccessorOrigin(origin)).toEqual(origin)
    expect(plan.source.sourceRef).toBe('https://example.org/report')
    expect(plan.evidence.sourceLocation).toEqual(origin.submission.source.locator)
    expect(plan.evidence.reviewStatus).toBe('PENDING_REVIEW')
    expect(plan.evidence.acceptanceState).toBe('CANDIDATE')
    for (const row of [plan, plan.source, plan.evidence]) {
      for (const key of ['verified', 'canAdmit', 'acceptedBy', 'acceptanceTimestamp', 'ready', 'snapshot', 'sourceCapture',
        'verificationContext', 'draftQualification', 'postLockAssociation', 'postLockImpactHistory']) expect(row).not.toHaveProperty(key)
    }
  })
  test('uses the same source-neutral planner for a Public-Research-shaped fixture without a provider', () => {
    const input = candidateArgs(payload => {
      payload.source.sourceId = 'registry:synthetic-public-record'
      payload.source.sourceType = 'PUBLIC_RESEARCH'
      payload.source.locator = { url: 'https://example.org/public-record', passage: 'Synthetic publicly recorded statement.' }
      payload.source.provenance = { ...payload.source.provenance, producerKey: 'public-research-fixture',
        producerVersion: 'fixture-only-1', receiptRef: 'fixture-only:public-research' }
      payload.source.qualifications = ['Synthetic shape only; no provider acquisition or authenticity proof.']
    })
    const plan = buildPostLockSuccessorCandidatePlan(input)
    expect(plan.source.sourceType).toBe('PUBLIC_RESEARCH')
    expect(plan.source.postLockOrigin.submission.source.sourceId).toBe('registry:synthetic-public-record')
    expect(plan.source.lineageRef).toBe('fixture-only:public-research')
    expect(plan.evidence.extractedFact).toBe(input.evidenceRow.extractedFact)
  })
  test.each(['missing-rationale', 'blank-rationale', 'confirm', 'head', 'version', 'request-key', 'actor', 'origin', 'extra-binding', 'unsafe'])('rejects %s public request', fault => {
    const input = candidateArgs().request
    if (fault === 'missing-rationale') delete input.rationale
    if (fault === 'blank-rationale') input.rationale = ' '
    if (fault === 'confirm') input.confirm = false
    if (fault === 'head') input.expectedImpactHeadHash = null
    if (fault === 'version') input.contractVersion = 'future'
    if (fault === 'request-key') input.requestKey = 'invalid'
    if (fault === 'actor') input.actorUserId = oid(999)
    if (fault === 'origin') input.postLockOrigin = {}
    if (fault === 'extra-binding') input.expectedBinding.extra = 'untrusted'
    if (fault === 'unsafe') Object.defineProperty(input, 'hidden', { value: 'unsafe', enumerable: false })
    admissionFailure(() => parsePostLockAdmissionRequest(input), 'REQUEST_INVALID', 422)
  })
  test('bounds canonical UTF8 request bytes rather than only character length', () => {
    const input = candidateArgs().request
    input.rationale = '字'.repeat(2000)
    Object.assign(input.expectedBinding, { runtimeInstanceKey: '字'.repeat(160), packageVersion: '字'.repeat(180),
      dependencySnapshotId: '字'.repeat(240), lockSnapshotId: '字'.repeat(240) })
    admissionFailure(() => parsePostLockAdmissionRequest(input), 'REQUEST_INVALID', 422)
  })
  test('binds deterministic request identity to scope and payload to the actual actor', () => {
    const first = parsePostLockAdmissionRequest(candidateArgs().request)
    expect(postLockAdmissionId(first)).toBe(postLockAdmissionId(JSON.parse(JSON.stringify(first))))
    expect(postLockAdmissionId({ ...first, expectedBinding: { ...first.expectedBinding, tenantId: oid(999) } })).not.toBe(postLockAdmissionId(first))
    expect(postLockAdmissionPayloadHash(first, oid(109))).not.toBe(postLockAdmissionPayloadHash(first, oid(999)))
    expect(postLockAdmissionPayloadHash(first, oid(109))).not.toBe(postLockAdmissionPayloadHash({ ...first, rationale: 'A different rationale.' }, oid(109)))
  })
  test.each(['digest', 'binding', 'head', 'submission'])('rejects stale %s before making candidate material', fault => {
    const input = candidateArgs()
    if (fault === 'digest') input.request.expectedSubmissionDigest = 'f'.repeat(64)
    if (fault === 'binding') input.request.expectedBinding = { ...input.request.expectedBinding, membershipHash: 'f'.repeat(64) }
    if (fault === 'head') input.request.expectedImpactHeadHash = 'f'.repeat(64)
    if (fault === 'submission') input.request.submissionId = 'f'.repeat(64)
    admissionFailure(() => buildPostLockSuccessorCandidatePlan(input), 'STALE', 409)
  })
  test.each(['NO_REVISION_IMPACT', 'CORROBORATIVE', 'CURRENTNESS_REVIEW_REQUIRED'])('refuses non-admitting latest %s even with consistent hashes', disposition => {
    const input = candidateArgs(), history = input.evidenceRow.postLockImpactHistory, entry = history.entries[0]
    entry.disposition = disposition
    entry.payloadHash = postLockImpactPayloadHash(postLockImpactRequestFromEntry(entry), entry.reviewerUserId, entry.submissionId)
    entry.decisionHash = postLockImpactDecisionHash(entry); history.headHash = entry.decisionHash
    input.request.expectedImpactHeadHash = entry.decisionHash
    admissionFailure(() => buildPostLockSuccessorCandidatePlan(input), 'DISPOSITION_BLOCKED', 409)
  })
  test('requires the complete current history and refuses retrying an older selection as a new plan', () => {
    const input = candidateArgs()
    input.evidenceRow.postLockImpactHistory = impactHistory(input.evidenceRow, 2)
    admissionFailure(() => buildPostLockSuccessorCandidatePlan(input), 'STALE', 409)
    input.request.expectedImpactHeadHash = input.evidenceRow.postLockImpactHistory.headHash
    const plan = buildPostLockSuccessorCandidatePlan(input)
    expect(plan.evidence.postLockOrigin.impact.sequence).toBe(2)
    expect(plan.evidence.postLockOrigin).not.toHaveProperty('history')
    input.evidenceRow.postLockImpactHistory.entries[0].rationale = 'Tampered earlier conclusion.'
    admissionFailure(() => buildPostLockSuccessorCandidatePlan(input), 'MATERIAL_INVALID', 503)
  })
  test.each(['receipt', 'submitter', 'source-qualification', 'statement', 'history-missing', 'history-null', 'association-trim'])('rejects altered or absent %s material', fault => {
    const input = candidateArgs()
    if (fault === 'receipt') input.evidenceRow.postLockAssociation.receiptId = oid(999)
    if (fault === 'submitter') input.evidenceRow.postLockAssociation.submittedBy = oid(999)
    if (fault === 'source-qualification') input.sourceRow.postLockAssociation.source.qualifications.push('Silent addition')
    if (fault === 'statement') input.evidenceRow.extractedFact += ' changed'
    if (fault === 'history-missing') delete input.evidenceRow.postLockImpactHistory
    if (fault === 'history-null') input.evidenceRow.postLockImpactHistory = null
    if (fault === 'association-trim') input.sourceRow.postLockAssociation.source.title += ' '
    admissionFailure(() => buildPostLockSuccessorCandidatePlan(input), 'MATERIAL_INVALID', 503)
  })
  test.each(['sourceType', 'contentHash', 'lineageRef'])('rejects retained evidence/source %s drift without repairing it silently', field => {
    const input = candidateArgs()
    input.evidenceRow[field] = field === 'contentHash' ? `sha256:${'f'.repeat(64)}` : 'DIFFERENT_RETAINED_VALUE'
    const before = JSON.stringify(input)
    admissionFailure(() => buildPostLockSuccessorCandidatePlan(input), 'MATERIAL_INVALID', 503)
    expect(JSON.stringify(input)).toBe(before)
  })
  test.each([false, '2026-11-06T12:03:00.000Z', '2026-11-06T12:02:59.000Z'])('refuses retention condition %s', condition => {
    const input = candidateArgs(payload => {
      if (condition === false) payload.source.licensing.retentionPermitted = false
      else payload.source.licensing.retainUntil = condition
    })
    admissionFailure(() => buildPostLockSuccessorCandidatePlan(input), 'RETENTION_BLOCKED', 409)
  })
  test('retains a future retention date exactly', () => {
    const input = candidateArgs(payload => { payload.source.licensing.retainUntil = '2026-11-06T12:03:00.001Z' })
    expect(buildPostLockSuccessorCandidatePlan(input).source.postLockOrigin.submission.source.licensing.retainUntil).toBe('2026-11-06T12:03:00.001Z')
  })
  test.each(['id', 'key', 'state', 'date', 'metadata-extra'])('rejects invalid server-assigned target/metadata %s', fault => {
    const input = candidateArgs()
    if (fault === 'id') input.target.runtimeInstanceId = input.request.expectedBinding.runtimeInstanceId
    if (fault === 'key') input.target.runtimeInstanceKey = input.request.expectedBinding.runtimeInstanceKey
    if (fault === 'state') input.target.stateVersion = input.request.expectedBinding.basisStateVersion
    if (fault === 'date') input.admission.admittedAt = 'not-a-date'
    if (fault === 'metadata-extra') input.admission.verified = true
    admissionFailure(() => buildPostLockSuccessorCandidatePlan(input), 'TARGET_INVALID', 422)
  })
  test.each(['origin-version', 'source', 'decision-hash', 'admission-hash', 'target-parent', 'future-impact', 'oversized', 'extra'])('rejects %s origin corruption instead of normalizing it', fault => {
    const input = candidateArgs(), origin = buildPostLockSuccessorCandidatePlan(input).source.postLockOrigin
    if (fault === 'origin-version') origin.contractVersion = 'future'
    if (fault === 'source') origin.submission.source.provenance.receiptRef += '-changed'
    if (fault === 'decision-hash') origin.impact.decisionHash = 'f'.repeat(64)
    if (fault === 'admission-hash') origin.admission.payloadHash = 'f'.repeat(64)
    if (fault === 'target-parent') origin.admission.target.runtimeInstanceId = origin.submission.binding.runtimeInstanceId
    if (fault === 'future-impact') origin.admission.admittedAt = '2026-11-06T12:01:59.000Z'
    if (fault === 'oversized') origin.submission.evidence.statement = 'x'.repeat(100000)
    if (fault === 'extra') origin.verified = true
    admissionFailure(() => parsePostLockSuccessorOrigin(origin), 'MATERIAL_INVALID', 503)
  })
})

const receiptMaterial = () => {
  const input = candidateArgs(), plan = buildPostLockSuccessorCandidatePlan(input), origin = plan.evidence.postLockOrigin
  const expectedUpdatedAt = '2026-11-06T12:00:00.000Z', reason = 'Normal explicit revision.'
  const receipt = { contractVersion: 'post-lock-admission-receipt.v1', admissionId: plan.admissionId,
    requestKey: input.request.requestKey, nestedRequestPayloadHash: plan.payloadHash,
    operationPayloadHash: postLockRevisionAdmissionOperationHash({ postLockAdmission: input.request,
      actorUserId: input.admission.actorUserId, expectedUpdatedAt, reason }), request: input.request,
    expectedUpdatedAt, revisionReason: reason, actorUserId: input.admission.actorUserId,
    admittedAt: input.admission.admittedAt, target: input.target, originHash: membershipHash(origin),
    auditId: input.admission.auditId, auditSignatureVersion: input.admission.auditSignatureVersion,
    basis: { fingerprintVersion: 'post-lock-successor-initial-basis.v1', manifestContractVersion: 'published-evidence-membership.v1',
      basisStateVersion: input.target.stateVersion, membershipHash: 'f'.repeat(64),
      scope: { customerId: oid(102), tenantId: oid(103), runtimeInstanceId: input.target.runtimeInstanceId,
        runtimeInstanceKey: input.target.runtimeInstanceKey, rootRuntimeInstanceId: oid(101),
        rootRuntimeInstanceKey: input.request.expectedBinding.runtimeInstanceKey, revisionNumber: 2, workspaceId: '' },
      package: { packageId: oid(104), packageKey: 'post-lock-contract-proof', packageVersion: '1.0',
        dependencyLockId: 'synthetic-dependency', activationId: 'synthetic-activation', deploymentId: 'synthetic-deployment' },
      counts: { sources: 1, evidence: 1, sections: 0 } } }
  return { input, plan, origin, receipt }
}

describe('exact post-lock item read-state grammar and bounded verification', () => {
  const at = '2026-11-06T12:04:00.000Z'
  const failure = reason => expect.objectContaining({ status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason } })
  const stateFailure = () => failure('POST_LOCK_READ_STATE_CAPACITY_EXCEEDED')
  const readState = (kind = 'pending') => {
    const value = { contractVersion: POST_LOCK_READ_STATE_VERSION, readAt: at, currency: 'AS_READ',
      impact: { state: 'NOT_RECORDED', verification: { status: 'VERIFIED', reason: null },
        headHash: null, latestDecision: null, decisionCount: 0 },
      admission: { state: 'NOT_RECORDED', verification: { status: 'NOT_APPLICABLE', reason: null }, initialBasis: null },
      actions: { recordImpact: { eligibility: 'ELIGIBLE_AS_READ', blockedBy: [] },
        admission: { eligibility: 'BLOCKED', blockedBy: ['POST_LOCK_ADMISSION_DECISION_REQUIRED'],
          operationalChecks: { indexes: 'NOT_CHECKED', execution: 'RECHECKED_ON_SUBMIT' } } } }
    if (kind === 'pending') return value
    const { origin, receipt } = receiptMaterial(), entry = origin.impact
    value.impact = { state: 'RECORDED', verification: { status: 'VERIFIED', reason: null }, headHash: entry.decisionHash,
      latestDecision: publicPostLockImpactEntry(entry, true, entry.decisionHash), decisionCount: entry.sequence }
    value.actions.admission = { ...value.actions.admission, eligibility: 'ELIGIBLE_AS_READ', blockedBy: [] }
    if (kind === 'reviewed') return value
    value.admission = { state: 'RECORDED', verification: { status: 'VERIFIED', reason: null },
      admissionId: receipt.admissionId, admittedAt: receipt.admittedAt, actorUserId: receipt.actorUserId, rationale: receipt.request.rationale,
      selectedDecision: { decisionId: entry.decisionId, decisionHash: entry.decisionHash, sequence: entry.sequence,
        disposition: 'SUCCESSOR_REVISION_REQUIRED' },
      child: { runtimeInstanceId: receipt.target.runtimeInstanceId, runtimeInstanceKey: receipt.target.runtimeInstanceKey,
        revisionNumber: receipt.basis.scope.revisionNumber },
      receipt: { auditId: receipt.auditId, signatureVersion: receipt.auditSignatureVersion },
      initialBasis: { status: 'NOT_REVALIDATED', basisStateVersion: receipt.basis.basisStateVersion, membershipHash: receipt.basis.membershipHash } }
    value.actions.admission = { ...value.actions.admission, eligibility: 'BLOCKED', blockedBy: ['POST_LOCK_ADMISSION_ALREADY_RECORDED'] }
    return value
  }
  const unverifiedImpact = reason => {
    const value = readState('reviewed')
    value.impact = { state: 'UNVERIFIED', verification: { status: 'UNVERIFIED', reason },
      headHash: null, latestDecision: null, decisionCount: 1 }
    for (const key of ['recordImpact', 'admission']) value.actions[key] = { ...value.actions[key], eligibility: 'BLOCKED', blockedBy: [reason] }
    return value
  }
  const unverifiedAdmission = reason => {
    const value = readState('reviewed')
    value.admission = { state: 'UNVERIFIED', verification: { status: 'UNVERIFIED', reason }, initialBasis: null }
    value.actions.admission = { ...value.actions.admission, eligibility: 'BLOCKED', blockedBy: ['POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED'] }
    return value
  }

  test.each(['pending', 'reviewed', 'admitted'])('accepts strict %s state without changing the original material', kind => {
    const value = readState(kind), original = JSON.stringify(value)
    expect(parsePostLockEvidenceReadState(value)).toEqual(value)
    expect(JSON.stringify(value)).toBe(original)
    expect(value).not.toHaveProperty('canAdmit')
    expect(value.actions.admission.operationalChecks).toEqual({ indexes: 'NOT_CHECKED', execution: 'RECHECKED_ON_SUBMIT' })
  })
  test.each(['POST_LOCK_IMPACT_AUDIT_NOT_RECORDED', 'POST_LOCK_IMPACT_AUDIT_UNVERIFIED'])('qualifies %s impact without exposing a current decision and blocks both actions', reason => {
    const value = unverifiedImpact(reason)
    expect(parsePostLockEvidenceReadState(value)).toEqual(value)
    expect(value.impact).toMatchObject({ headHash: null, latestDecision: null })
  })
  test.each(['POST_LOCK_ADMISSION_AUDIT_NOT_RECORDED', 'POST_LOCK_ADMISSION_AUDIT_UNVERIFIED',
    'POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED', 'POST_LOCK_ADMISSION_CHILD_UNAVAILABLE', 'POST_LOCK_ADMISSION_CHILD_AMBIGUOUS'])('qualifies %s admission independently of impact recording', reason => {
    const value = unverifiedAdmission(reason)
    expect(parsePostLockEvidenceReadState(value)).toEqual(value)
    expect(value.actions.recordImpact).toEqual({ eligibility: 'ELIGIBLE_AS_READ', blockedBy: [] })
    for (const key of ['child', 'receipt', 'rationale', 'actorUserId']) expect(value.admission).not.toHaveProperty(key)
  })
  test('a later verified head and historical selected admission stay distinct', () => {
    const value = readState('admitted'), selected = { ...value.admission.selectedDecision }
    value.impact.latestDecision = { ...value.impact.latestDecision, decisionId: `post_lock_impact_${'2'.repeat(64)}`,
      sequence: 2, disposition: 'CURRENTNESS_REVIEW_REQUIRED', decisionHash: '3'.repeat(64),
      previousDecisionHash: value.impact.headHash }
    value.impact.headHash = value.impact.latestDecision.decisionHash
    value.impact.decisionCount = 2
    value.actions.admission.blockedBy.push('POST_LOCK_ADMISSION_DISPOSITION_BLOCKED')
    expect(parsePostLockEvidenceReadState(value).admission.selectedDecision).toEqual(selected)
    expect(value.admission.initialBasis.status).toBe('NOT_REVALIDATED')
  })
  test.each(['root-extra', 'currency', 'date', 'pending-count', 'pending-head', 'pending-verification',
    'recorded-latest-missing', 'head-mismatch', 'not-current', 'not-verified', 'raw-decision',
    'unverified-head', 'unverified-latest', 'impact-material-reason', 'impact-unknown-reason',
    'missing-impact-blocker', 'spurious-impact-blocker', 'pending-child', 'unverified-child',
    'unverified-actor', 'admission-basis', 'admission-disposition', 'admission-receipt',
    'admission-not-blocked', 'unverified-admission-not-blocked', 'eligible-without-decision',
    'blocked-empty', 'eligible-blocked', 'duplicate-reason', 'unknown-reason', 'wrong-action-reason',
    'checked-indexes', 'full-history', 'raw-admission'])('rejects illegal %s instead of manufacturing a truthful read state', fault => {
    let value = readState(['pending-count', 'pending-head', 'pending-verification', 'eligible-without-decision', 'pending-child'].includes(fault) ? 'pending' : 'admitted')
    if (fault === 'root-extra') value.canAdmit = true
    if (fault === 'currency') value.currency = 'CURRENT'
    if (fault === 'date') value.readAt = '2026-11-06T12:04:00Z'
    if (fault === 'pending-count') value.impact.decisionCount = 1
    if (fault === 'pending-head') value.impact.headHash = '0'.repeat(64)
    if (fault === 'pending-verification') value.impact.verification.status = 'UNVERIFIED'
    if (fault === 'recorded-latest-missing') value.impact.latestDecision = null
    if (fault === 'head-mismatch') value.impact.headHash = '0'.repeat(64)
    if (fault === 'not-current') value.impact.latestDecision.isCurrent = false
    if (fault === 'not-verified') value.impact.latestDecision.verified = false
    if (fault === 'raw-decision') value.impact.latestDecision.audit.signature = 'private raw signature'
    if (['unverified-head', 'unverified-latest', 'impact-material-reason', 'impact-unknown-reason', 'missing-impact-blocker'].includes(fault)) {
      const latest = value.impact.latestDecision; value = unverifiedImpact('POST_LOCK_IMPACT_AUDIT_UNVERIFIED')
      if (fault === 'unverified-head') value.impact.headHash = '0'.repeat(64)
      if (fault === 'unverified-latest') value.impact.latestDecision = latest
      if (fault === 'impact-material-reason') value.impact.verification.reason = 'POST_LOCK_IMPACT_HISTORY_INVALID'
      if (fault === 'impact-unknown-reason') value.impact.verification.reason = 'UNKNOWN'
      if (fault === 'missing-impact-blocker') value.actions.recordImpact = { eligibility: 'ELIGIBLE_AS_READ', blockedBy: [] }
    }
    if (fault === 'spurious-impact-blocker') value.actions.recordImpact = { eligibility: 'BLOCKED', blockedBy: ['POST_LOCK_IMPACT_AUDIT_UNVERIFIED'] }
    if (fault === 'pending-child') value.admission.child = { runtimeInstanceId: oid(202) }
    if (fault === 'unverified-child' || fault === 'unverified-actor' || fault === 'unverified-admission-not-blocked') {
      value = unverifiedAdmission('POST_LOCK_ADMISSION_AUDIT_UNVERIFIED')
      if (fault === 'unverified-child') value.admission.child = { runtimeInstanceId: oid(202) }
      if (fault === 'unverified-actor') value.admission.actorUserId = oid(109)
      if (fault === 'unverified-admission-not-blocked') value.actions.admission = { ...value.actions.admission, eligibility: 'ELIGIBLE_AS_READ', blockedBy: [] }
    }
    if (fault === 'admission-basis') value.admission.initialBasis.status = 'VERIFIED'
    if (fault === 'admission-disposition') value.admission.selectedDecision.disposition = 'CORROBORATIVE'
    if (fault === 'admission-receipt') value.admission.receipt.signatureVersion = 0
    if (fault === 'admission-not-blocked') value.actions.admission = { ...value.actions.admission, eligibility: 'ELIGIBLE_AS_READ', blockedBy: [] }
    if (fault === 'eligible-without-decision') value.actions.admission = { ...value.actions.admission, eligibility: 'ELIGIBLE_AS_READ', blockedBy: [] }
    if (fault === 'blocked-empty') value.actions.recordImpact = { eligibility: 'BLOCKED', blockedBy: [] }
    if (fault === 'eligible-blocked') value.actions.recordImpact.blockedBy = ['VMF_UPDATE_REQUIRED']
    if (fault === 'duplicate-reason') value.actions.recordImpact = { eligibility: 'BLOCKED', blockedBy: ['VMF_UPDATE_REQUIRED', 'VMF_UPDATE_REQUIRED'] }
    if (fault === 'unknown-reason') value.actions.recordImpact = { eligibility: 'BLOCKED', blockedBy: ['UNKNOWN'] }
    if (fault === 'wrong-action-reason') value.actions.admission.blockedBy.push('POST_LOCK_IMPACT_CAPACITY')
    if (fault === 'checked-indexes') value.actions.admission.operationalChecks.indexes = 'VERIFIED'
    if (fault === 'full-history') value.impact.entries = []
    if (fault === 'raw-admission') value.admission.rawReceipt = {}
    expect(() => parsePostLockEvidenceReadState(value)).toThrow(stateFailure())
  })
  test.each(['accessor', 'symbol', 'undefined', 'bigint', 'hidden', 'foreign-prototype'])('rejects unsafe %s material without executing an accessor', fault => {
    const value = readState(); let reads = 0
    if (fault === 'accessor') Object.defineProperty(value, 'currency', { enumerable: true, get() { reads++; return 'AS_READ' } })
    if (fault === 'symbol') value[Symbol('hidden')] = true
    if (fault === 'undefined') value.currency = undefined
    if (fault === 'bigint') value.impact.decisionCount = 0n
    if (fault === 'hidden') Object.defineProperty(value, 'hidden', { value: true, enumerable: false })
    if (fault === 'foreign-prototype') Object.setPrototypeOf(value, { inherited: true })
    expect(() => parsePostLockEvidenceReadState(value)).toThrow(stateFailure())
    expect(reads).toBe(0)
  })
  test('maximum supported escaped and Unicode material fits strict state and full response bounds unchanged', () => {
    const value = readState('admitted')
    value.impact.latestDecision.rationale = '\u0000'.repeat(2000)
    value.admission.rationale = '\u0000'.repeat(2000)
    value.admission.child.runtimeInstanceKey = '界'.repeat(160)
    const parsed = parsePostLockEvidenceReadState(value)
    expect(parsed).toEqual(value)
    expect(Buffer.byteLength(JSON.stringify(parsed))).toBeLessThanOrEqual(READ_STATE_MAX_BYTES)
    const payload = fixture()
    payload.evidence.statement = '\u0000'.repeat(8000); payload.evidence.title = '\u0000'.repeat(1000)
    payload.source.title = '界'.repeat(1000); payload.source.licensing.licenceRef = 'l'.repeat(2000)
    payload.source.provenance.receiptRef = 'r'.repeat(1000); payload.reason = '界'.repeat(500)
    const submission = parsePostLockSubmission(payload)
    const envelope = { data: { contractVersion: submission.contractVersion, submissionId: postLockSubmissionId(submission),
      status: 'PENDING_REVIEW', requestDigest: postLockRequestDigest(submission, oid(109)), outsideFrozenMembership: true,
      binding: submission.binding, source: submission.source, evidence: submission.evidence, reason: submission.reason,
      submittedBy: oid(109), submittedAt: at, receipt: { id: oid(120), signatureVersion: 2, verified: true }, readState: parsed },
      meta: { requestId: '123e4567-e89b-42d3-a456-426614174999', version: 'v1' } }
    expect(() => assertPostLockReadResponseEnvelope(envelope)).not.toThrow()
    expect(Buffer.byteLength(JSON.stringify(envelope))).toBeLessThanOrEqual(READ_RESPONSE_MAX_BYTES)
    expect(envelope.data.evidence.statement).toHaveLength(8000)
    expect(READ_STATE_MAX_BYTES).toBe(48 * 1024)
  })
  test('oversized or unsafe projected state refuses its fixed capacity class without truncating input', () => {
    const value = readState('admitted'); value.admission.rationale = 'x'.repeat(READ_STATE_MAX_BYTES)
    const before = JSON.stringify(value)
    expect(() => parsePostLockEvidenceReadState(value)).toThrow(stateFailure())
    expect(JSON.stringify(value)).toBe(before)
  })
  test('response serialization accepts exactly 128 KiB and rejects the next UTF-8 byte without partial data', () => {
    const envelope = { data: { text: '' }, meta: { requestId: '123e4567-e89b-42d3-a456-426614174999', version: 'v1' } }
    const base = Buffer.byteLength(JSON.stringify(envelope))
    envelope.data.text = 'x'.repeat(READ_RESPONSE_MAX_BYTES - base)
    expect(Buffer.byteLength(JSON.stringify(envelope))).toBe(128 * 1024)
    expect(() => assertPostLockReadResponseEnvelope(envelope)).not.toThrow()
    envelope.data.text += 'x'
    expect(() => assertPostLockReadResponseEnvelope(envelope)).toThrow(failure('POST_LOCK_READ_RESPONSE_CAPACITY_EXCEEDED'))
    envelope.data.text = '界'.repeat(Math.ceil(READ_RESPONSE_MAX_BYTES / 3))
    expect(() => assertPostLockReadResponseEnvelope(envelope)).toThrow(failure('POST_LOCK_READ_RESPONSE_CAPACITY_EXCEEDED'))
  })
  test('one deadline gives every query the remaining finite allowance and cannot reset between callers', () => {
    let clock = 100
    const budget = createPostLockReadBudget({ now: () => clock })
    expect(budget()).toEqual({ maxTimeMS: 2000 })
    expect(budget.remainingMS()).toBe(6000)
    clock += 4001
    expect(budget()).toEqual({ maxTimeMS: 1999 })
    expect(budget.remainingMS()).toBe(1999)
    clock += 1998
    expect(budget()).toEqual({ maxTimeMS: 1 })
    clock++
    expect(() => budget()).toThrow(failure('POST_LOCK_READ_STATE_DEADLINE_EXCEEDED'))
    expect(() => budget.check()).toThrow(failure('POST_LOCK_READ_STATE_DEADLINE_EXCEEDED'))
  })
  test('new audit verification accounting is cumulative, accepts exactly 512 KiB and refuses additional material', () => {
    const budget = createPostLockReadBudget({ now: () => 0 }), first = [{ material: 'a'.repeat(1000) }]
    const firstBytes = Buffer.byteLength(JSON.stringify(first)), base = Buffer.byteLength(JSON.stringify([{ material: '' }]))
    const second = [{ material: 'b'.repeat(READ_AUDIT_MAX_BYTES - firstBytes - base) }]
    expect(firstBytes + Buffer.byteLength(JSON.stringify(second))).toBe(512 * 1024)
    expect(() => budget.accountAuditRows(first)).not.toThrow()
    expect(() => budget.accountAuditRows(second)).not.toThrow()
    expect(() => budget.accountAuditRows([])).toThrow(failure('POST_LOCK_READ_STATE_AUDIT_CAPACITY_EXCEEDED'))
    expect(READ_AUDIT_MAX_BYTES).toBe(512 * 1024)
  })
  test.each([{ code: 50 }, { code: 262 }, { codeName: 'MaxTimeMSExpired' }, { codeName: 'ExceededTimeLimit' },
    { name: 'MongoOperationTimeoutError' }, { name: 'MongoNetworkTimeoutError' }])('outer normalization recognizes timeout identity %j without message matching', identity => {
    const error = Object.assign(new Error('Private dependency detail.'), identity)
    const normalized = normalizePostLockReadStateError(error, createPostLockReadBudget({ now: () => 0 }))
    expect(normalized).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason: 'POST_LOCK_READ_STATE_DEADLINE_EXCEEDED' } })
    expect(normalized.message).not.toContain(error.message)
  })
  test.each(['timeout message only', 'server selection', 'transient surfaced', 'unknown commit surfaced'])('outer %s failure with time remaining is an exact dependency error', kind => {
    const error = new Error(kind === 'timeout message only' ? 'Private timeout in mongo://secret-host.' : 'Private dependency detail.')
    if (kind === 'server selection') error.name = 'MongoServerSelectionError'
    if (kind === 'transient surfaced') error.hasErrorLabel = label => label === 'TransientTransactionError'
    if (kind === 'unknown commit surfaced') error.hasErrorLabel = label => label === 'UnknownTransactionCommitResult'
    const normalized = normalizePostLockReadStateError(error, createPostLockReadBudget({ now: () => 0 }))
    expect(normalized).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason: 'POST_LOCK_READ_STATE_DEPENDENCY_UNAVAILABLE' } })
    expect(normalized.details).toEqual({ reason: 'POST_LOCK_READ_STATE_DEPENDENCY_UNAVAILABLE' })
    expect(normalized.message).not.toContain('Private')
  })
  test.each([{ status: 401, code: 'UNAUTHENTICATED' }, { status: 403, code: 'FORBIDDEN', details: { permission: 'VMF_VIEW' } },
    { status: 404, code: 'NOT_FOUND', details: { reason: 'POST_LOCK_SUBMISSION_NOT_FOUND' } },
    { status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason: 'POST_LOCK_RECEIPT_UNVERIFIED' } },
    { status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason: 'POST_LOCK_IMPACT_HISTORY_INVALID' } }])('preserves protected typed error %j exactly', material => {
    const error = Object.assign(new Error('Original protected error.'), material)
    expect(normalizePostLockReadStateError(error, createPostLockReadBudget({ now: () => 0 }))).toBe(error)
  })
  test.each(['POST_LOCK_READ_STATE_AUDIT_CAPACITY_EXCEEDED', 'POST_LOCK_READ_STATE_CAPACITY_EXCEEDED',
    'POST_LOCK_READ_RESPONSE_CAPACITY_EXCEEDED'])('preserves %s unless the shared deadline itself is spent', reason => {
    let clock = 0
    const budget = createPostLockReadBudget({ now: () => clock }), error = Object.assign(new Error('Capacity exceeded.'), {
      status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason } })
    expect(normalizePostLockReadStateError(error, budget)).toBe(error)
    clock = 6000
    expect(normalizePostLockReadStateError(error, budget)).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE',
      details: { reason: 'POST_LOCK_READ_STATE_DEADLINE_EXCEEDED' } })
  })
  test('spent shared deadline takes precedence over the final unclassified dependency rejection', () => {
    let clock = 0
    const budget = createPostLockReadBudget({ now: () => clock }); clock = 6000
    expect(normalizePostLockReadStateError(new Error('Private dependency detail.'), budget)).toMatchObject({
      status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason: 'POST_LOCK_READ_STATE_DEADLINE_EXCEEDED' } })
  })
})

describe('successor admission native material and ordinary projection boundaries', () => {
  test('operation replay identity binds the normal revision reason and timestamp separately from the nested request', () => {
    const { input, receipt } = receiptMaterial(), base = { postLockAdmission: input.request, actorUserId: oid(109),
      expectedUpdatedAt: receipt.expectedUpdatedAt, reason: receipt.revisionReason }
    expect(postLockRevisionAdmissionOperationHash(base)).toBe(receipt.operationPayloadHash)
    expect(postLockRevisionAdmissionOperationHash({ ...base, reason: 'A different normal revision reason.' })).not.toBe(receipt.operationPayloadHash)
    expect(postLockRevisionAdmissionOperationHash({ ...base, expectedUpdatedAt: '2026-11-06T12:00:00.001Z' })).not.toBe(receipt.operationPayloadHash)
    expect(postLockAdmissionPayloadHash(input.request, oid(109))).toBe(receipt.nestedRequestPayloadHash)
  })
  test.each(['operation', 'nested', 'target', 'scope', 'package', 'basis-state', 'origin-hash', 'extra'])('rejects corrupt %s retained receipt material', fault => {
    const { receipt, origin } = receiptMaterial()
    if (fault === 'operation') receipt.operationPayloadHash = '0'.repeat(64)
    if (fault === 'nested') receipt.nestedRequestPayloadHash = '0'.repeat(64)
    if (fault === 'target') receipt.target.runtimeInstanceId = oid(101)
    if (fault === 'scope') receipt.basis.scope.customerId = oid(999)
    if (fault === 'package') receipt.basis.package.packageId = oid(999)
    if (fault === 'basis-state') receipt.basis.basisStateVersion = 'rsv2:123e4567-e89b-42d3-a456-426614174999'
    if (fault === 'origin-hash') receipt.originHash = '0'.repeat(64)
    if (fault === 'extra') receipt.verified = true
    expect(() => assertPostLockAdmissionReceiptOrigin(receipt, origin)).toThrow(expect.objectContaining({
      status: 503, details: { reason: 'POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED' },
    }))
  })
  test('the material receipt retains historical admission authority without pretending to verify a signature', () => {
    const { receipt, origin } = receiptMaterial()
    expect(parsePostLockAdmissionReceipt(receipt)).toEqual(receipt)
    expect(assertPostLockAdmissionReceiptOrigin(receipt, origin)).toEqual(receipt)
    expect(receipt).not.toHaveProperty('verified')
    expect(receipt.basis).not.toHaveProperty('snapshotId')
    expect(receipt.basis).not.toHaveProperty('locked')
  })
  test('pending receipt stays valid after a later impact entry but cannot be attached to an unrelated owner', async () => {
    const { input, receipt } = receiptMaterial(), pending = input.evidenceRow
    pending.postLockAdmission = receipt
    expect(validPostLockAdmissionRow(pending)).toBe(true)
    pending.postLockImpactHistory = impactHistory(pending, 2)
    expect(validPostLockAdmissionRow(pending)).toBe(true)
    await expect(new RuntimeEvidenceObject(pending).validate()).resolves.toBeUndefined()
    const wrong = { ...pending, runtimeInstanceId: oid(999) }
    expect(validPostLockAdmissionRow(wrong)).toBe(false)
    await expect(new RuntimeEvidenceObject(wrong).validate()).rejects.toThrow()
    expect(() => new RuntimeEvidenceSource({ ...input.sourceRow, postLockAdmission: receipt })).toThrow()
  })
  test('child revision receipt is historical across state evolution and rejects a different parent', async () => {
    const { receipt, input } = receiptMaterial()
    const child = { _id: input.target.runtimeInstanceId, runtimeInstanceKey: input.target.runtimeInstanceKey,
      customerId: oid(102), tenantId: oid(103), name: 'Synthetic ordinary draft', frameworkKey: 'SS056_SYNTHETIC',
      runtimeType: 'VALUE_NARRATIVE', packageId: oid(104), packageKey: 'post-lock-contract-proof', packageVersion: '1.0',
      dependencyLockId: 'synthetic-dependency', activationId: 'synthetic-activation', deploymentId: 'synthetic-deployment',
      evidence: { activationId: 'synthetic-activation', deploymentId: 'synthetic-deployment',
        dependencySnapshotId: 'synthetic-dependency', dependencySnapshotHash: 'c'.repeat(64) },
      status: 'ACTIVE', executionStatus: 'IDLE', stateVersion: input.target.stateVersion,
      createdBy: oid(109), revision: { revisionNumber: 2, parentRuntimeId: oid(101),
        parentRuntimeInstanceKey: input.request.expectedBinding.runtimeInstanceKey, rootRuntimeId: oid(101),
        rootRuntimeInstanceKey: input.request.expectedBinding.runtimeInstanceKey, createdFromRevision: 1,
        postLockAdmission: receipt } }
    expect(validPostLockRevisionAdmission(child)).toBe(true)
    await expect(new RuntimeInstance(child).validate()).resolves.toBeUndefined()
    child.stateVersion = 'rsv2:123e4567-e89b-42d3-a456-426614174777'
    await expect(new RuntimeInstance(child).validate()).rejects.toThrow(/postLockAdmission/)
    await expect(RuntimeInstance.hydrate(child).validate()).resolves.toBeUndefined()
    child.revision.parentRuntimeId = oid(999)
    expect(validPostLockRevisionAdmission(child)).toBe(false)
    await expect(RuntimeInstance.hydrate(child).validate()).rejects.toThrow()
  })
  test('normalization, native mapping and qualification preserve the exact origin while keeping candidates unaccepted', async () => {
    const input = candidateArgs(payload => { payload.evidence.statement = 'Exact  words\nretain their internal spacing.' })
    const plan = buildPostLockSuccessorCandidatePlan(input)
    const evidence = normalizeDiscoveryEvidenceObjects({ evidenceObjects: [plan.evidence], sourceRegistry: [plan.source], sources: [plan.source] })
    const sources = buildDiscoverySourceRegistry({ sourceRegistry: [plan.source], evidenceObjects: evidence, sources: [plan.source] })
    expect(evidence[0]).toMatchObject({ reviewStatus: 'PENDING', acceptanceState: 'CANDIDATE', extractedFact: input.evidenceRow.extractedFact })
    expect(evidence[0].extractedFact).toBe(input.evidenceRow.extractedFact)
    assertPostLockOriginPairs({ sources, evidenceObjects: evidence })
    const native = createRuntimeStateLegacySourceRowSet({ legacyInput: { rawBsonBytes: 1000,
      sections: {}, evidencePack: { sourceRegistry: sources, evidenceObjects: evidence },
      intelligenceGraph: { graphVersion: input.target.stateVersion, nodes: [], edges: [] } },
      scope: { customerId: oid(102), tenantId: oid(103), runtimeInstanceId: input.target.runtimeInstanceId,
        runtimeInstanceKey: input.target.runtimeInstanceKey }, stateVersion: input.target.stateVersion,
      migrationReceiptId: oid(105), migrationTimestamp: input.admission.admittedAt })
    const source = native.rows.evidenceSources[0], row = native.rows.evidenceObjects[0]
    expect(source.postLockOrigin).toEqual(plan.source.postLockOrigin)
    expect(row.postLockOrigin).toEqual(plan.evidence.postLockOrigin)
    expect(row.extractedFact).toBe(input.evidenceRow.extractedFact)
    await expect(new RuntimeEvidenceSource(source).validate()).resolves.toBeUndefined()
    await expect(new RuntimeEvidenceObject(row).validate()).resolves.toBeUndefined()
    const qualifications = buildRuntimeSectionEvidenceQualifications({ sourceRegistry: sources, lineageSources: sources,
      evidenceObjects: evidence, admittedEvidenceIds: [row.evidenceObjectId] })
    expect(qualifications.sources[0].postLockOrigin.submission.source).toEqual(input.sourceRow.postLockAssociation.source)
    expect(qualifications.evidence[0].postLockOrigin).toEqual(plan.evidence.postLockOrigin)
    expect(qualifications.sources[0].sourceReview).toMatchObject({ status: 'NOT_RECORDED', authenticity: null })
  })
  test.each(['source-missing', 'evidence-missing', 'duplicated-source', 'source-mismatch', 'statement'])('origin pairs reject %s instead of treating structural material as authority', fault => {
    const { plan } = receiptMaterial(), sources = [plan.source], evidenceObjects = [plan.evidence]
    if (fault === 'source-missing') delete sources[0].postLockOrigin
    if (fault === 'evidence-missing') delete evidenceObjects[0].postLockOrigin
    if (fault === 'duplicated-source') sources.push(structuredClone(sources[0]))
    if (fault === 'source-mismatch') sources[0].postLockOrigin.submission.source.qualifications.push('Unrecorded change.')
    if (fault === 'statement') evidenceObjects[0].extractedFact = 'Altered original claim.'
    expect(() => assertPostLockOriginPairs({ sources, evidenceObjects })).toThrow()
  })
  test('an orphan origin-bearing source cannot pass pair verification without any evidence owner', () => {
    const { plan } = receiptMaterial()
    expect(() => assertPostLockOriginPairs({ sources: [plan.source], evidenceObjects: [] })).toThrow(expect.objectContaining({
      status: 503, details: { reason: 'POST_LOCK_ADMISSION_MATERIAL_INVALID' },
    }))
  })
  test('qualification of a legitimate selected subset ignores unrelated origin-bearing sources outside that subset', () => {
    const { plan } = receiptMaterial()
    const ordinarySource = { sourceId: 'ordinary-source', sourceType: 'MANUAL_DOCUMENT',
      title: 'Ordinary source', sourceRef: 'https://example.org/ordinary', lineageRef: 'ordinary:receipt' }
    const ordinaryEvidence = { evidenceObjectId: 'ordinary-evidence', sourceId: ordinarySource.sourceId,
      extractedFact: 'An existing ordinary selected fact.', reviewStatus: 'ACCEPTED', lineageRef: ordinarySource.lineageRef }
    const result = buildRuntimeSectionEvidenceQualifications({ sourceRegistry: [ordinarySource, plan.source],
      lineageSources: [ordinarySource, plan.source], evidenceObjects: [ordinaryEvidence], admittedEvidenceIds: [ordinaryEvidence.evidenceObjectId] })
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0].sourceId).toBe(ordinarySource.sourceId)
    expect(result.evidence).toHaveLength(1)
    expect(result.evidence[0].evidenceObjectId).toBe(ordinaryEvidence.evidenceObjectId)
    expect(result.sources[0]).not.toHaveProperty('postLockOrigin')
  })
  test('original origin remains historical when normal current rows move to another state and review status', () => {
    const { plan } = receiptMaterial()
    const row = { ...plan.evidence, customerId: oid(102), tenantId: oid(103), runtimeInstanceId: oid(303),
      stateVersion: 'rsv2:123e4567-e89b-42d3-a456-426614174999', reviewStatus: 'REJECTED' }
    expect(projectPostLockOrigin(row, 'evidence').postLockOrigin).toEqual(plan.evidence.postLockOrigin)
  })
  test('exact three-reference policy adds admission without silently upgrading either older policy', () => withFixturePolicy(() => {
    const runtime = { packageId: oid(104), frameworkKey: 'SS056_SYNTHETIC', packageKey: 'post-lock-contract-proof', packageVersion: '1.0',
      dependencyLockId: 'dependency', evidence: { dependencySnapshotHash: 'f'.repeat(64) } }
    const make = refs => { const policy = { contractVersion: 'framework-package-discovery-policy-v1', policyKey: 'pending', policyVersion: '1.0',
      postLockDiscoveryPolicy: { enabled: true, mutateLockedRevision: false, references: refs,
        ...(refs.length > 1 ? { allowedDispositions: Object.values(POST_LOCK_DISCOVERY_DISPOSITIONS) } : {}) } }
      return { _id: runtime.packageId, frameworkKey: runtime.frameworkKey, packageKey: runtime.packageKey, version: '1.0',
        discoveryPolicy: policy, dependencyLock: { ...discoveryPolicySnapshot(policy), snapshotId: 'dependency', snapshotHash: 'f'.repeat(64) } } }
    const one = make([{ ...POST_LOCK_RECORDING_REFERENCE }])
    expect(assertPostLockRecordingBinding({ frameworkPackage: one, runtime })).toBe(one.dependencyLock.discoveryPolicyHash)
    expect(() => assertPostLockRecordingBinding({ frameworkPackage: one, runtime, operation: 'impact' })).toThrow()
    expect(() => assertPostLockRecordingBinding({ frameworkPackage: one, runtime, operation: 'admission' })).toThrow()
    const two = make([{ ...POST_LOCK_RECORDING_REFERENCE }, { ...POST_LOCK_HUMAN_IMPACT_REFERENCE }])
    expect(assertPostLockRecordingBinding({ frameworkPackage: two, runtime, operation: 'impact' })).toBe(two.dependencyLock.discoveryPolicyHash)
    expect(() => assertPostLockRecordingBinding({ frameworkPackage: two, runtime, operation: 'admission' })).toThrow()
    const three = make([{ ...POST_LOCK_RECORDING_REFERENCE }, { ...POST_LOCK_HUMAN_IMPACT_REFERENCE }, { ...POST_LOCK_ADMISSION_REFERENCE }])
    for (const operation of ['recording', 'impact', 'admission']) expect(assertPostLockRecordingBinding({ frameworkPackage: three, runtime, operation })).toBe(three.dependencyLock.discoveryPolicyHash)
    three.discoveryPolicy.postLockDiscoveryPolicy.references[2].implementationVersion = 'future'
    expect(() => assertPostLockRecordingBinding({ frameworkPackage: three, runtime, operation: 'admission' })).toThrow()
  }))
})

describe('discoverable original post-lock receipt list contract (no database execution)', () => {
  const listFailure = (reason, status = 503) => expect.objectContaining({ status,
    details: { reason: `POST_LOCK_EVIDENCE_LIST_${reason}` } })
  const frame = () => {
    const binding = fixture().binding
    return { runtime: { id: binding.runtimeInstanceId, customerId: binding.customerId, tenantId: binding.tenantId,
      runtimeInstanceKey: binding.runtimeInstanceKey, revision: { revisionNumber: binding.revisionNumber },
      stateVersion: binding.basisStateVersion, frameworkKey: 'SS056_SYNTHETIC', packageId: binding.packageId,
      packageVersion: binding.packageVersion, dependencyLockId: binding.dependencySnapshotId,
      evidence: { dependencySnapshotHash: binding.dependencySnapshotHash } },
    body: { basisStateVersion: binding.basisStateVersion, evidence: [],
      scope: { customerId: binding.customerId, tenantId: binding.tenantId, runtimeInstanceId: binding.runtimeInstanceId,
        runtimeInstanceKey: binding.runtimeInstanceKey, rootRuntimeInstanceId: binding.runtimeInstanceId,
        rootRuntimeInstanceKey: binding.runtimeInstanceKey, revisionNumber: 1, workspaceId: '' },
      package: { packageId: binding.packageId, packageKey: 'post-lock-contract-proof', packageVersion: binding.packageVersion,
        dependencyLockId: binding.dependencySnapshotId, activationId: 'synthetic-activation', deploymentId: 'synthetic-deployment' } },
    pointer: { contractVersion: 'runtime-evidence-membership.v1', snapshotId: binding.evidenceSnapshotId,
      membershipHash: binding.membershipHash, basisStateVersion: binding.basisStateVersion,
      lockSnapshotId: binding.lockSnapshotId, lockSnapshotHash: binding.lockSnapshotHash } }
  }
  const original = (input = fixture(), index = 1) => {
    const payload = parsePostLockSubmission(input), submissionId = postLockSubmissionId(payload)
    const digest = postLockRequestDigest(payload, oid(109)), b = payload.binding
    const association = { contractVersion: POST_LOCK_ASSOCIATION_VERSION, submissionId, requestKey: payload.requestKey,
      requestDigest: digest, binding: b, submittedBy: oid(109), submittedAt: '2026-11-06T12:01:00.000Z',
      receiptId: oid(500 + index), status: 'PENDING_REVIEW' }
    const common = { customerId: b.customerId, tenantId: b.tenantId, runtimeInstanceId: b.runtimeInstanceId,
      runtimeInstanceKey: b.runtimeInstanceKey, stateVersion: b.basisStateVersion, sourceStateVersion: b.basisStateVersion,
      sourceHash: postLockSourceHash(digest), current: false, sourceId: `post-lock-source:${submissionId}`,
      sourceType: payload.source.sourceType, contentHash: payload.source.contentHash,
      lineageRef: payload.source.provenance.receiptRef, reviewStatus: 'PENDING_REVIEW' }
    const source = { ...common, _id: oid(600 + index), title: payload.source.title, sourceRef: payload.source.locator.url || '',
      acquisitionStatus: 'POST_LOCK_PENDING', postLockAssociation: { ...association, source: payload.source } }
    const evidence = { ...common, _id: oid(700 + index), evidenceObjectId: `post-lock:${submissionId}`, title: payload.evidence.title,
      extractedFact: payload.evidence.statement, acceptanceState: 'POST_LOCK_PENDING',
      postLockAssociation: { ...association, evidence: payload.evidence, reason: payload.reason } }
    const audit = new AuditLog({ _id: association.receiptId, actorUserId: association.submittedBy,
      action: 'POST_LOCK_EVIDENCE_SUBMITTED', resourceType: 'RuntimeInstance', resourceId: b.runtimeInstanceId,
      scope: { customerId: b.customerId, tenantId: b.tenantId, runtimeInstanceId: b.runtimeInstanceId, runtimeInstanceKey: b.runtimeInstanceKey },
      diff: { contractVersion: POST_LOCK_ASSOCIATION_VERSION, submissionId, requestDigest: digest, binding: b,
        submittedBy: association.submittedBy, submittedAt: association.submittedAt,
        sourceRowId: source._id, evidenceRowId: evidence._id } })
    audit.generateSignature()
    const pair = parsePostLockOriginalPair({ source, evidence, submissionId })
    assertPostLockOriginalPairBinding({ pair, ...frame() })
    return { payload, source, evidence, audit, pair,
      receipt: verifyPostLockOriginalReceipt({ pair, audit, submissionId }) }
  }
  const maximum = index => {
    const input = fixture()
    input.requestKey = `123e4567-e89b-42d3-a456-${String(100 + index).padStart(12, '0')}`
    input.source.sourceId = '\u0000'.repeat(239) + 'é'
    input.source.sourceType = 'M'.repeat(100)
    input.source.title = '\u0000'.repeat(999) + 'é'
    input.evidence.title = '\u0000'.repeat(999) + 'é'
    input.evidence.statement = '\u0000'.repeat(7999) + 'é'
    input.source.qualifications = []
    const size = () => Buffer.byteLength(buildCanonicalJson(input), 'utf8')
    for (let item = 0; item < 20 && size() + 10 < 65500; item++) {
      const prefix = `${item}:`
      input.source.qualifications.push(prefix)
      const count = Math.min(500 - prefix.length, Math.floor((65500 - size()) / 6))
      input.source.qualifications[item] += '\u0000'.repeat(count)
    }
    expect(size()).toBeGreaterThanOrEqual(65000)
    expect(size()).toBeLessThanOrEqual(65536)
    return original(input, index)
  }
  const query = () => ({ customerId: oid(102), tenantId: oid(103) })
  const rawCursor = json => `${POST_LOCK_EVIDENCE_LIST_VERSION}.${Buffer.from(json).toString('base64url')}`

  test('requires one strict selected scope and defaults a canonical bounded page size', () => {
    expect(parsePostLockEvidenceListQuery(query())).toEqual({ ...query(), pageSize: 5 })
    for (const pageSize of ['1', 1, '10', 10]) expect(parsePostLockEvidenceListQuery({ ...query(), pageSize }).pageSize).toBe(Number(pageSize))
  })
  test.each([{}, { ...query(), extra: true }, { ...query(), pageSize: true }, { ...query(), pageSize: ['1'] },
    { ...query(), pageSize: '01' }, { ...query(), pageSize: '1e1' }, { ...query(), pageSize: '' },
    { ...query(), pageSize: 0 }, { ...query(), pageSize: 11 }, { ...query(), cursor: [] }])('rejects unsupported list query %j', input => {
    expect(() => parsePostLockEvidenceListQuery(input)).toThrow(listFailure('QUERY_INVALID', 422))
  })
  test('canonical namespaced cursor names only the verified basis and lexical last position', () => {
    const basis = buildPostLockEvidenceListBasis(frame()), afterEvidenceObjectId = `post-lock:${'a'.repeat(64)}`
    const cursor = encodePostLockEvidenceListCursor({ basisHash: basis.basisHash, afterEvidenceObjectId })
    expect(parsePostLockEvidenceListCursor(cursor)).toEqual({ contractVersion: 'post-lock-evidence-list-cursor.v1',
      basisHash: basis.basisHash, afterEvidenceObjectId })
    expect(parsePostLockEvidenceListQuery({ ...query(), cursor, pageSize: 1 }).cursor).toBe(cursor)
    expect(parsePostLockEvidenceListCursor(undefined)).toBeNull()
  })
  test.each(['namespace', 'padding', 'extra', 'duplicate', 'whitespace', 'version', 'position', 'oversized'])('rejects %s cursor without disclosing material', fault => {
    const value = { afterEvidenceObjectId: `post-lock:${'a'.repeat(64)}`, basisHash: 'b'.repeat(64), contractVersion: 'post-lock-evidence-list-cursor.v1' }
    let cursor = rawCursor(buildCanonicalJson(value))
    if (fault === 'namespace') cursor = cursor.replace('list.v1.', 'list.v2.')
    if (fault === 'padding') cursor += '='
    if (fault === 'extra') cursor = rawCursor(buildCanonicalJson({ ...value, token: 'private' }))
    if (fault === 'duplicate') cursor = rawCursor(`{"basisHash":"${value.basisHash}",${buildCanonicalJson(value).slice(1)}`)
    if (fault === 'whitespace') cursor = rawCursor(' ' + buildCanonicalJson(value))
    if (fault === 'version') cursor = rawCursor(buildCanonicalJson({ ...value, contractVersion: 'future' }))
    if (fault === 'position') cursor = rawCursor(buildCanonicalJson({ ...value, afterEvidenceObjectId: 'post-lock:other' }))
    if (fault === 'oversized') cursor = 'x'.repeat(1025)
    expect(() => parsePostLockEvidenceListCursor(cursor)).toThrow(listFailure('CURSOR_INVALID', 422))
  })
  test('basis is independent of current policy but binds the actual frozen scope and dependency hash', () => {
    const selected = frame(), before = buildPostLockEvidenceListBasis(selected).basisHash
    selected.runtime.currentPolicy = { enabled: false }
    selected.runtime.evidence.discoveryPolicyHash = 'f'.repeat(64)
    expect(buildPostLockEvidenceListBasis(selected).basisHash).toBe(before)
    selected.runtime.evidence.dependencySnapshotHash = 'f'.repeat(64)
    expect(buildPostLockEvidenceListBasis(selected).basisHash).not.toBe(before)
    selected.pointer.membershipHash = 'e'.repeat(64)
    expect(buildPostLockEvidenceListBasis(selected).basisHash).not.toBe(before)
  })
  test('verified lookahead makes a cursor after the returned item and never infers current review or admission', () => {
    const first = original(), nextInput = fixture(); nextInput.requestKey = '123e4567-e89b-42d3-a456-426614174099'
    const receipts = [first.receipt, original(nextInput, 2).receipt].sort((a, b) => a.submissionId.localeCompare(b.submissionId))
    receipts[0].postLockAdmission = { private: 'not loaded' }
    receipts[0].postLockImpactHistory = { private: 'not loaded' }
    const result = projectPostLockEvidenceList({ frame: frame(), receipts, pageSize: 1 })
    expect(result.items).toHaveLength(1)
    expect(result.items[0].originalIntake).toMatchObject({ recordedStatus: 'PENDING_REVIEW', outsideFrozenMembership: true })
    expect(result.items[0].detail).toEqual({ contractVersion: 'post-lock-evidence-read-state.v1', impact: 'NOT_LOADED', admission: 'NOT_LOADED' })
    expect(parsePostLockEvidenceListCursor(result.pagination.nextCursor).afterEvidenceObjectId).toBe(`post-lock:${receipts[0].submissionId}`)
    for (const key of ['status', 'pendingCount', 'total', 'totalPages']) expect(result).not.toHaveProperty(key)
    expect(JSON.stringify(result)).not.toMatch(/postLockAdmission|postLockImpactHistory|not loaded/)
    expect(projectPostLockEvidenceList({ frame: frame(), receipts: [], pageSize: 1 }).pagination)
      .toEqual({ pageSize: 1, hasMore: false, nextCursor: null })
  })
  test('bad lookahead receipt cannot be used to advertise a next page', () => {
    const input = fixture(), first = original(); input.requestKey = '123e4567-e89b-42d3-a456-426614174099'
    const receipts = [first.receipt, original(input, 2).receipt].sort((a, b) => a.submissionId.localeCompare(b.submissionId))
    receipts[1].receipt.verified = false
    expect(() => projectPostLockEvidenceList({ frame: frame(), receipts, pageSize: 1 })).toThrow(listFailure('RESPONSE_CAPACITY_EXCEEDED'))
  })
  test('two near64KiB escaped Unicode original pairs and actual model signatures fit a one-item page plus lookahead', () => {
    const pairs = [maximum(1), maximum(2)], receipts = pairs.map(row => row.receipt).sort((a, b) => a.submissionId.localeCompare(b.submissionId))
    expect(() => assertPostLockEvidenceListMaterialSize(pairs.map(row => row.evidence), pairs.map(row => row.source))).not.toThrow()
    expect(Buffer.byteLength(JSON.stringify({ evidenceRows: pairs.map(row => row.evidence), sourceRows: pairs.map(row => row.source) }))).toBeLessThan(LIST_MATERIAL_MAX_BYTES)
    for (const pair of pairs) expect(pair.audit.verifySignature()).toBe(true)
    const data = projectPostLockEvidenceList({ frame: frame(), receipts, pageSize: 1 })
    expect(data.items[0].evidenceTitle).toBe(pairs[0].payload.evidence.title)
    expect(data.items[0].source.title).toBe(pairs[0].payload.source.title)
    expect(Buffer.byteLength(JSON.stringify({ data, meta: { requestId: '00000000-0000-4000-8000-000000000000', version: 'v1' } }))).toBeLessThan(LIST_RESPONSE_MAX_BYTES)
  })
  test('larger valid original receipts fail closed rather than truncate, and the same basis supports a smaller page', () => {
    const pairs = Array.from({ length: 11 }, (_, index) => maximum(index + 1))
    const receipts = pairs.map(row => row.receipt).sort((a, b) => a.submissionId.localeCompare(b.submissionId))
    expect(() => assertPostLockEvidenceListMaterialSize(pairs.map(row => row.evidence), pairs.map(row => row.source))).toThrow(listFailure('MATERIAL_CAPACITY_EXCEEDED'))
    expect(() => projectPostLockEvidenceList({ frame: frame(), receipts, pageSize: 10 })).toThrow(listFailure('RESPONSE_CAPACITY_EXCEEDED'))
    const smaller = projectPostLockEvidenceList({ frame: frame(), receipts: receipts.slice(0, 2), pageSize: 1 })
    expect(smaller.basis.basisHash).toBe(buildPostLockEvidenceListBasis(frame()).basisHash)
    expect(smaller.pagination.hasMore).toBe(true)
  })
  test('extracted original verifier still rejects an unsigned material change', () => {
    const pair = original()
    pair.audit.diff.evidenceRowId = oid(999)
    expect(() => verifyPostLockOriginalReceipt({ pair: pair.pair, audit: pair.audit, submissionId: pair.receipt.submissionId }))
      .toThrow(expect.objectContaining({ status: 503, details: { reason: 'POST_LOCK_RECEIPT_UNVERIFIED' } }))
  })
  test('raw material and complete response boundaries are byte exact', () => {
    const evidence = [{ value: '' }], sources = []
    evidence[0].value = 'x'.repeat(LIST_MATERIAL_MAX_BYTES - Buffer.byteLength(JSON.stringify({ evidenceRows: evidence, sourceRows: sources })))
    expect(() => assertPostLockEvidenceListMaterialSize(evidence, sources)).not.toThrow()
    evidence[0].value += 'x'
    expect(() => assertPostLockEvidenceListMaterialSize(evidence, sources)).toThrow(listFailure('MATERIAL_CAPACITY_EXCEEDED'))
    const envelope = { data: { value: '' }, meta: { requestId: 'actual wrapper bytes', version: 'v1' } }
    envelope.data.value = 'x'.repeat(LIST_RESPONSE_MAX_BYTES - Buffer.byteLength(JSON.stringify(envelope)))
    expect(() => assertPostLockEvidenceListResponseEnvelope(envelope)).not.toThrow()
    envelope.data.value += 'x'
    expect(() => assertPostLockEvidenceListResponseEnvelope(envelope)).toThrow(listFailure('RESPONSE_CAPACITY_EXCEEDED'))
  })
  test.each(['DEADLINE_EXCEEDED', 'AUDIT_CAPACITY_EXCEEDED', 'RESPONSE_CAPACITY_EXCEEDED', 'DEPENDENCY_UNAVAILABLE'])('maps the shared %s result into only the fixed list namespace', suffix => {
    const shared = suffix === 'RESPONSE_CAPACITY_EXCEEDED' ? 'POST_LOCK_READ_RESPONSE_CAPACITY_EXCEEDED' : `POST_LOCK_READ_STATE_${suffix}`
    const error = Object.assign(new Error('Private shared detail.'), { status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason: shared } })
    expect(normalizePostLockEvidenceListError(error, createPostLockReadBudget({ now: () => 0 }))).toMatchObject(listFailure(suffix))
  })
  test('unknown typed errors and inherited reason names cannot bypass the list error grammar', () => {
    const error = Object.assign(new Error('Private dependency detail.'), { status: 503, code: 'PRIVATE_STORE', details: { reason: 'private', token: 'secret' } })
    const normalized = normalizePostLockEvidenceListError(error, createPostLockReadBudget({ now: () => 0 }))
    expect(normalized).toMatchObject(listFailure('DEPENDENCY_UNAVAILABLE'))
    expect(normalized.details).toEqual({ reason: 'POST_LOCK_EVIDENCE_LIST_DEPENDENCY_UNAVAILABLE' })
    expect(normalized.message).not.toContain('Private')
    expect(isPostLockEvidenceListError({ details: { reason: 'constructor' } })).toBe(false)
  })
  test('own cursor identity stays specific while capacity yields to the same spent deadline', () => {
    let clock = 0
    const budget = createPostLockReadBudget({ now: () => clock })
    const stale = postLockEvidenceListError('POST_LOCK_EVIDENCE_LIST_CURSOR_STALE')
    expect(normalizePostLockEvidenceListError(stale, budget)).toBe(stale)
    clock = 6000
    expect(normalizePostLockEvidenceListError(postLockEvidenceListError('POST_LOCK_EVIDENCE_LIST_MATERIAL_CAPACITY_EXCEEDED'), budget))
      .toMatchObject(listFailure('DEADLINE_EXCEEDED'))
  })
})
