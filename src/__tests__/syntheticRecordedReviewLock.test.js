import { test, describe, expect, beforeAll, afterAll } from '@jest/globals'
import fs from 'node:fs'
import mongoose from 'mongoose'
import env from '../config/env.js'
import { verifyRecordedSyntheticReviewForLock as verify, RECORDED_SYNTHETIC_REVIEW_WITNESS as w,
  RECORDED_SOURCE_REFRESH_WITNESS as f } from '../services/syntheticRecordedReviewLockService.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { SYNTHETIC_REVISION_TEST_POLICY as p } from '../constants/syntheticRevisionTestPolicy.js'
import Audit from '../models/AuditLog.js'
import { RECORDED_PUBLISH_GRAPH_WITNESS as g } from '../services/syntheticRecordedReviewLockService.js'

// Private native readback is an opt-in counterexample, not a seeded approval.
const dir = process.env.VMF_RECORDED_R3_CACHE
const cached = dir ? describe : describe.skip
cached('recorded native R3 completion lock contract', () => {
  let previousEnvironment
  beforeAll(() => { previousEnvironment = env.appEnv; env.appEnv = 'development' })
  afterAll(() => { env.appEnv = previousEnvironment })
  const fixture = () => {
    const read = name => mongoose.mongo.BSON.EJSON.parse(fs.readFileSync(dir + '/' + name, 'utf8'), { relaxed: true })
    const data = read('native-after-private.ejson.json'), runtime = data.roots.find(r => String(r._id) === p.runtimeInstanceId)
    const receipt = data.held.runtime_review_completions[0], completionAudit = read('native-after-new-audits.ejson.json')[0]
    const reviewAudit = read('review-business-audit.ejson.json')
    const state = { runtime, records: [receipt], audits: [completionAudit, reviewAudit], transitions: [],
      material: { materialHash: w.materialHash }, population: { manifest: receipt.manifest,
        populationHash: receipt.populationHash, summary: { complete: true, confirmedReadinessBlockers: 0 } } }
    const deps = {
      readRows: async (name, filter, session) => {
        expect(session).toBe(state.session)
        if (name === 'runtime_review_completions') {
          expect(String(filter.runtimeInstanceId)).toBe(p.runtimeInstanceId)
          expect(String(filter.customerId)).toBe(p.customerId)
          return state.records
        }
        return state.transitions
      },
      readOne: async (name, filter) => state.audits.find(a => String(a._id) === String(filter._id)),
      verifySignature: a => Boolean(a?.signature) && a.signature !== 'tampered',
      compileMaterial: async () => state.material,
      compilePopulation: async control => { expect(control.id).toBe(p.runtimeInstanceId); return state.population },
    }
    state.session = { inTransaction: () => true }
    return { state, args: { runtime, session: state.session, deps } }
  }
  test('accepts the existing signed decision/completion without creating another receipt or mutating history', async () => {
    const { state, args } = fixture(), before = JSON.stringify(state)
    expect(await verify(args)).toMatchObject({ route: w.route, authoritative: false, completionId: w.completionId,
      reviewId: w.reviewId, materialHash: w.materialHash, basisStateVersion: w.stateVersion })
    expect(JSON.stringify(state)).toBe(before)
  })
  test.each(['noReview', 'noCompletion', 'duplicateCompletion', 'scope', 'manifest', 'completionId', 'receiptActor',
    'receiptTime', 'reviewChanged', 'reviewActor', 'reviewEpoch', 'completionAuditMissing', 'reviewAuditMissing',
    'completionSignature', 'reviewSignature', 'auditScope', 'auditRationale', 'material', 'population', 'blocking', 'unsignedState',
    'contractVersion', 'receiptPolicy', 'receiptKeyWithNoReview'])('rejects %s without alternate test-route fallback', async kind => {
    const { state, args } = fixture(), receipt = state.records[0], review = state.runtime.framework_state.evidence_pack.contradictionReviews.find(r => r.reviewId === w.reviewId)
    if (kind === 'noReview') state.runtime.framework_state.evidence_pack.contradictionReviews = []
    if (kind === 'noCompletion') state.records = []
    if (kind === 'duplicateCompletion') state.records.push(receipt)
    if (kind === 'scope') state.runtime.customerId = new mongoose.Types.ObjectId()
    if (kind === 'manifest') receipt.manifest.evidence.pop()
    if (kind === 'completionId') receipt.receiptId = 'changed'
    if (kind === 'receiptActor') receipt.actorUserId = new mongoose.Types.ObjectId()
    if (kind === 'receiptTime') receipt.completedAt = new Date('2026-10-20T00:00:00Z')
    if (kind === 'reviewChanged') review.rationale += ' changed'
    if (kind === 'reviewActor') review.reviewedBy = '1'.repeat(24)
    if (kind === 'reviewEpoch') state.runtime.framework_state.evidence_pack.contradictionReviewEpoch = '11111111-1111-4111-8111-111111111111'
    if (kind === 'completionAuditMissing') state.audits.shift()
    if (kind === 'reviewAuditMissing') state.audits.pop()
    if (kind === 'completionSignature') state.audits[0].signature = 'tampered'
    if (kind === 'reviewSignature') state.audits[1].signature = 'tampered'
    if (kind === 'auditScope') state.audits[0].scope.tenantId = new mongoose.Types.ObjectId()
    if (kind === 'auditRationale') state.audits[0].diff.rationale = 'changed'
    if (kind === 'material') state.material.materialHash = '0'.repeat(64)
    if (kind === 'population') state.population.populationHash = '0'.repeat(64)
    if (kind === 'blocking') state.population.summary.confirmedReadinessBlockers = 1
    if (kind === 'unsignedState') state.runtime.stateVersion = 'rsv2:11111111-1111-4111-8111-111111111111'
    if (kind === 'contractVersion') receipt.contractVersion = 'unsupported'
    if (kind === 'receiptPolicy') receipt.populationPolicy = 'unsupported'
    if (kind === 'receiptKeyWithNoReview') {
      delete receipt.runtimeInstanceKey; state.runtime.framework_state.evidence_pack.contradictionReviews = []
    }
    await expect(verify(args)).rejects.toThrow()
  })
  test('only absence of both recorded-route indicators permits the unchanged older test path', async () => {
    const { state, args } = fixture()
    state.records = []; state.runtime.framework_state.evidence_pack.contradictionReviews = []
    expect(await verify(args)).toBeNull()
    await expect(verify({ ...args, lockAudit: { diff: { recordedReviewCompletion: {} } } })).rejects.toThrow()
  })
  test('signed lifecycle rollover and exact separate lock link are required at snapshot consumption', async () => {
    const { state, args } = fixture(), link = await verify(args)
    const next = 'rsv2:11111111-1111-4111-8111-111111111111', time = '2026-10-20T14:00:00.000Z'
    const audit = { signature: 'valid', resourceType: 'RuntimeInstance', resourceId: state.runtime._id,
      action: 'RUNTIME_ACTION_EXECUTED', scope: { customerId: p.customerId, tenantId: p.tenantId,
        runtimeInstanceId: p.runtimeInstanceId, runtimeInstanceKey: p.runtimeInstanceKey },
      diff: { actionKey: 'LOCK_RECORD', updatedAtBefore: w.completedAt, updatedAtAfter: time,
        syntheticTestStateTransition: { from: w.stateVersion, to: next }, runtimeStateSource: { sourceSetHash: 'sha256:recorded' },
        recordedReviewCompletion: link } }
    state.runtime.stateVersion = next; state.runtime.updatedAt = new Date(time); state.transitions = [audit]
    expect(await verify({ ...args, lockAudit: audit })).toEqual(link)
    audit.diff.syntheticTestCompletion = {}; await expect(verify({ ...args, lockAudit: audit })).rejects.toThrow()
    delete audit.diff.syntheticTestCompletion; audit.diff.recordedReviewCompletion.materialHash = 'changed'
    await expect(verify({ ...args, lockAudit: audit })).rejects.toThrow()
  })
})

const refreshedDir = process.env.VMF_RECORDED_R3_REFRESH_CACHE
;(dir && refreshedDir ? describe : describe.skip)('recorded R3 native source refresh consumption', () => {
  let previousEnvironment
  beforeAll(() => { previousEnvironment = env.appEnv; env.appEnv = 'development' })
  afterAll(() => { env.appEnv = previousEnvironment })
  const fixture = () => {
    const read = path => mongoose.mongo.BSON.EJSON.parse(fs.readFileSync(path, 'utf8'), { relaxed: true })
    const data = read(refreshedDir + '/evidence-accepted-final-private.ejson.json')
    const runtime = data.roots.find(r => String(r._id) === p.runtimeInstanceId)
    const receipt = data.held.runtime_review_completions[0]
    const state = { runtime, records: [receipt], audits: data.audits.concat(read(dir + '/review-business-audit.ejson.json')),
      refreshAudits: data.audits.filter(a => f.audits.some(([id]) => id === String(a._id))), transitions: [],
      material: JSON.parse(fs.readFileSync(refreshedDir + '/source-refresh-material-private.json', 'utf8')),
      population: { manifest: receipt.manifest, populationHash: receipt.populationHash,
        summary: { complete: true, confirmedReadinessBlockers: 0 } } }
    const deps = {
      readRows: async (name, filter) => name === 'runtime_review_completions' ? state.records
        : filter._id?.$in ? state.refreshAudits : state.transitions,
      readOne: async (name, filter) => state.audits.find(a => String(a._id) === String(filter._id)),
      verifySignature: a => Boolean(a?.signature) && a.signature !== 'tampered',
      compileMaterial: async () => state.material,
      compilePopulation: async () => state.population,
    }
    return { state, args: { runtime, deps } }
  }
  test('binds exactly three actual native refreshes to unchanged original qualified material', async () => {
    const { state, args } = fixture(), before = JSON.stringify(state)
    expect(await verify(args)).toMatchObject({ route: w.route, authoritative: false,
      completionId: w.completionId, completionBasisStateVersion: w.stateVersion, originalMaterialHash: w.materialHash,
      materialHash: f.materialHash, basisStateVersion: f.stateVersion, sourceRefreshWitnessHash: membershipHash(f) })
    expect(JSON.stringify(state)).toBe(before)
  })
  test.each(['missingAudit', 'duplicateAudit', 'auditBody', 'auditSignature', 'auditScope', 'provider', 'generated',
    'accepted', 'missingHistory', 'ambiguousHistory', 'oldGenerated', 'input', 'mapping', 'fourthSection',
    'evidence', 'source', 'qualification', 'packAcceptance', 'state', 'time', 'material'])('rejects refreshed %s', async kind => {
    const { state, args } = fixture(), section = state.runtime.framework_state.sections.strategic_objectives
    if (kind === 'missingAudit') state.refreshAudits.pop()
    if (kind === 'duplicateAudit') state.refreshAudits[1] = state.refreshAudits[0]
    if (kind === 'auditBody') state.refreshAudits[0].diff.actionKey = 'SAVE'
    if (kind === 'auditSignature') state.refreshAudits[0].signature = 'tampered'
    if (kind === 'auditScope') state.refreshAudits[0].scope.customerId = new mongoose.Types.ObjectId()
    if (kind === 'provider') section.generated.generator.providerMetadata.responseId = 'different'
    if (kind === 'generated') section.generated.content += 'changed'
    if (kind === 'accepted') section.accepted.content += 'changed'
    const prior = section.revisions.find(r => membershipHash(r.accepted) === f.sections[0][3])
    if (kind === 'missingHistory') section.revisions = section.revisions.filter(r => r !== prior)
    if (kind === 'ambiguousHistory') section.revisions.push(prior)
    if (kind === 'oldGenerated') prior.generated.content += 'changed'
    if (kind === 'input') section.input = { changed: true }
    if (kind === 'mapping') section.evidenceObjects = [{ evidenceObjectId: 'unreviewed' }]
    if (kind === 'fourthSection') state.material.manifest.sections.find(s => s.key === 'customer_context').hash = 'changed'
    if (kind === 'evidence' || kind === 'qualification') state.material.manifest.population[0].hash = 'changed'
    if (kind === 'source') state.material.manifest.sources[0].hash = 'changed'
    if (kind === 'packAcceptance') state.runtime.framework_state.evidence_pack.acceptedAt = '2026-10-20T15:00:00.000Z'
    if (kind === 'state') state.runtime.stateVersion = 'rsv2:11111111-1111-4111-8111-111111111111'
    if (kind === 'time') state.runtime.updatedAt = new Date('2026-10-20T15:00:00.000Z')
    if (kind === 'material') state.material.materialHash = '0'.repeat(64)
    await expect(verify(args)).rejects.toThrow()
  })
  test('requires a signed lifecycle tail and exact refreshed lock link at consumption', async () => {
    const { state, args } = fixture(), link = await verify(args)
    const next = 'rsv2:11111111-1111-4111-8111-111111111111', time = '2026-10-20T15:00:00.000Z'
    const audit = { signature: 'valid', action: 'RUNTIME_ACTION_EXECUTED', resourceType: 'RuntimeInstance',
      resourceId: state.runtime._id, scope: { customerId: p.customerId, tenantId: p.tenantId,
        runtimeInstanceId: p.runtimeInstanceId, runtimeInstanceKey: p.runtimeInstanceKey },
      diff: { actionKey: 'LOCK_RECORD', updatedAtBefore: f.updatedAt, updatedAtAfter: time,
        syntheticTestStateTransition: { from: f.stateVersion, to: next }, runtimeStateSource: { sourceSetHash: 'sha256:recorded' },
        recordedReviewCompletion: link } }
    state.runtime.stateVersion = next; state.runtime.updatedAt = new Date(time); state.transitions = [audit]
    expect(await verify({ ...args, lockAudit: audit })).toEqual(link)
    audit.diff.recordedReviewCompletion.sourceRefreshWitnessHash = 'changed'
    await expect(verify({ ...args, lockAudit: audit })).rejects.toThrow()
  })

  const graphDir = process.env.VMF_RECORDED_R3_GRAPH_CACHE
  const graphTest = graphDir ? test : test.skip
  const publishedFixture = () => {
    const read = name => mongoose.mongo.BSON.EJSON.parse(fs.readFileSync(graphDir + '/' + name, 'utf8'), { relaxed: true })
    const actual = read('independent-publish-graph-native-private.ejson.json')
    const cached = read('native-published-private.ejson.json'), { state, args } = fixture()
    state.runtime = actual.root; args.runtime = state.runtime
    state.audits = Array.from(new Map(cached.audits.concat(actual.audits).map(a => [String(a._id), a])).values())
    state.graphs = actual.graphs
    args.deps.verifySignature = row => Boolean(row && Audit.hydrate(row).verifySignature())
    args.deps.readRows = async (name, filter) => {
      if (name === 'runtime_review_completions') return state.records
      if (name === 'runtime_graph_snapshots') return state.graphs
      if (filter._id?.$in) return state.refreshAudits
      if (filter['diff.operation']) return state.audits.filter(a => a.diff?.operation === filter['diff.operation']
        && a.diff.sourceStateVersion === filter['diff.sourceStateVersion'])
      return state.audits.filter(a => a.action === 'RUNTIME_ACTION_EXECUTED'
        && a.diff?.syntheticTestStateTransition?.to === filter['diff.syntheticTestStateTransition.to'])
    }
    return { state, args }
  }
  graphTest('verifies actual native published root, signed audits and immutable graph without changing original anchors', async () => {
    const { state, args } = publishedFixture(), before = JSON.stringify(state)
    expect(await verify(args)).toMatchObject({ publishGraphWitnessHash: membershipHash(g), materialHash: f.materialHash,
      originalMaterialHash: w.materialHash, basisStateVersion: f.stateVersion })
    expect(JSON.stringify(state)).toBe(before)
  })
  graphTest.each(['time', 'publishFingerprint', 'missingPromotion', 'duplicatePromotion', 'unsignedPromotion',
    'promotionScope', 'graphMaterial', 'missingGraph', 'duplicateGraph', 'graphHash', 'graphState'])('rejects historical graph %s', async kind => {
    const { state, args } = publishedFixture()
    const promotion = state.audits.find(a => String(a._id) === g.promotionAuditId)
    // Deduplicate capture overlap while retaining the tested native ambiguity below.
    state.audits = Array.from(new Map(state.audits.map(a => [String(a._id), a])).values())
    if (kind === 'time') state.runtime.updatedAt = new Date('2026-10-20T15:00:00.000Z')
    if (kind === 'publishFingerprint') state.audits.find(a => String(a._id) === g.actionAuditId).diff.actionedAt = 'changed'
    if (kind === 'missingPromotion') state.audits = state.audits.filter(a => String(a._id) !== g.promotionAuditId)
    if (kind === 'duplicatePromotion') state.audits.push(promotion)
    if (kind === 'unsignedPromotion') promotion.signature = 'tampered'
    if (kind === 'promotionScope') promotion.scope.tenantId = new mongoose.Types.ObjectId()
    if (kind === 'graphMaterial') state.graphs[0].metadata = { changed: true }
    if (kind === 'missingGraph') state.graphs = []
    if (kind === 'duplicateGraph') state.graphs.push(state.graphs[0])
    if (kind === 'graphHash') state.graphs[0].graphHash = 'sha256:' + '0'.repeat(64)
    if (kind === 'graphState') state.graphs[0].sourceStateVersion = f.stateVersion
    await expect(verify(args)).rejects.toThrow()
  })
  const futureFixture = async () => {
    const { state, args } = publishedFixture()
    state.audits = Array.from(new Map(state.audits.map(a => [String(a._id), a])).values())
    const link = await verify(args), version = 'rsv2:11111111-1111-4111-8111-111111111111'
    const actionTime = '2026-10-20T15:00:00.000Z', graphTime = '2026-10-20T15:00:01.000Z'
    const graph = { ...state.graphs[0], _id: new mongoose.Types.ObjectId(), snapshotId: 'rgs:' + 'a'.repeat(64),
      graphHash: 'sha256:' + 'a'.repeat(64), stateVersion: version, sourceStateVersion: version }
    const scope = { customerId: p.customerId, tenantId: p.tenantId, runtimeInstanceId: p.runtimeInstanceId, runtimeInstanceKey: p.runtimeInstanceKey }
    const action = { _id: new mongoose.Types.ObjectId(), signature: 'test-signed', action: 'RUNTIME_ACTION_EXECUTED',
      resourceId: state.runtime._id, resourceType: 'RuntimeInstance', scope,
      diff: { actionKey: 'LOCK_RECORD', updatedAtBefore: g.observedRootUpdatedAt, updatedAtAfter: actionTime,
        syntheticTestStateTransition: { from: g.stateVersion, to: version }, runtimeStateSource: { sourceSetHash: 'sha256:test' },
        intelligenceGraph: { nextGraphHash: graph.graphHash }, recordedReviewCompletion: link } }
    const promotion = { _id: new mongoose.Types.ObjectId(), signature: 'test-signed', action: 'RUNTIME_STATE_MUTATED',
      resourceId: state.runtime._id, resourceType: 'RuntimeInstance', scope,
      diff: { operation: 'V2_GRAPH_REBUILD_PROMOTED', sourceStateVersion: version, newSnapshotId: graph.snapshotId,
        graphHash: graph.graphHash, counts: graph.counts,
        rootUpdatedAtTransition: { contractVersion: 'runtime-graph-root-currentness.v1', before: actionTime, after: graphTime } } }
    state.graphs[0].current = false; state.graphs[0].stateStatus = 'STALE'; state.graphs[0].updatedAt = new Date(graphTime)
    state.graphs.push(graph); state.audits.push(action, promotion)
    const readRows = args.deps.readRows
    args.deps.readRows = async (name, filter) => name === 'runtime_graph_snapshots'
      ? state.graphs.filter(row => row.stateVersion === filter.stateVersion) : readRows(name, filter)
    const verifySignature = args.deps.verifySignature
    args.deps.verifySignature = row => row?.signature === 'test-signed' || verifySignature(row)
    state.runtime.stateVersion = version; state.runtime.updatedAt = new Date(graphTime)
    return { state, args, action, promotion, graph, link }
  }
  graphTest('consumes a signed future lock graph timestamp hop and unchanged historical publish witness', async () => {
    const { args, action, link } = await futureFixture()
    expect(await verify({ ...args, lockAudit: action })).toEqual(link)
  })
  graphTest.each(['before', 'after', 'version', 'missingTransition', 'signature', 'scope', 'snapshot', 'graphHash',
    'state', 'missing', 'duplicate', 'graph', 'lockLink'])('rejects future graph %s', async kind => {
    const { state, args, action, promotion, graph } = await futureFixture()
    if (kind === 'before') promotion.diff.rootUpdatedAtTransition.before = '2026-10-20T14:00:00.000Z'
    if (kind === 'after') promotion.diff.rootUpdatedAtTransition.after = '2026-10-20T15:00:02.000Z'
    if (kind === 'version') promotion.diff.rootUpdatedAtTransition.contractVersion = 'unknown'
    if (kind === 'missingTransition') delete promotion.diff.rootUpdatedAtTransition
    if (kind === 'signature') promotion.signature = 'tampered'
    if (kind === 'scope') promotion.scope.customerId = '0'.repeat(24)
    if (kind === 'snapshot') promotion.diff.newSnapshotId = 'wrong'
    if (kind === 'graphHash') promotion.diff.graphHash = 'sha256:' + '0'.repeat(64)
    if (kind === 'state') promotion.diff.sourceStateVersion = f.stateVersion
    if (kind === 'missing') state.audits = state.audits.filter(a => a !== promotion)
    if (kind === 'duplicate') state.audits.push(promotion)
    if (kind === 'graph') graph.sourceStateVersion = f.stateVersion
    if (kind === 'lockLink') action.diff.recordedReviewCompletion.publishGraphWitnessHash = 'changed'
    await expect(verify({ ...args, lockAudit: action })).rejects.toThrow()
  })
})
