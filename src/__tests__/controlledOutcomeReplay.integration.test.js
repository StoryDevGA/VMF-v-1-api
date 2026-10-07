import { describe, test, expect, jest } from '@jest/globals'
import express from 'express'
import request from 'supertest'
import mongoose from 'mongoose'
import { createHash } from 'node:crypto'
import { EJSON } from 'bson'
import { validateControlledAuthority, hashControlledAuthority } from '../../scripts/controlledOutcomeReplayFixture.mjs'
import { hashDevelopmentTestReadinessContent } from '../services/outcomeStudioReadinessService.js'
import { buildOutcomeKnowledgeCompositionPlanCandidate } from '../services/outcomeKnowledgeCompositionPlanService.js'
import { buildKnowledgePackRelationshipChecksum } from '../services/knowledgePackRelationshipContract.js'
import { CONTROLLED_HOST, CONTROLLED_ORIGIN, controlledRequestGuard,
  createSingleReplayLatch, assertIsolatedReplayDatabase, createControlledReplayApp,
  assertControlledReplayRuntimeBinding, createControlledPreflightStopFactory, ensureControlledIndexes } from '../../scripts/serveControlledOutcomeReplay.mjs'
import { OutcomeKnowledgeCompositionPlan, OutcomeQualityStageExecution,
  GovernedReasoningExecution, GovernedRuntimeArtifact } from '../models/index.js'

describe('controlled index isolation before DDL', () => {
  test.each(['remote.example', undefined, '127.0.0.1'])('checks connection %s before creating collections or indexes', async (host) => {
    const descriptor = Object.getOwnPropertyDescriptor(mongoose.connection, 'host')
    const models = [OutcomeKnowledgeCompositionPlan, OutcomeQualityStageExecution, GovernedReasoningExecution, GovernedRuntimeArtifact]
    const spies = models.flatMap((model) => ['createCollection', 'createIndexes'].map((method) => jest.spyOn(model, method).mockResolvedValue(undefined)))
    Object.defineProperty(mongoose.connection, 'host', { configurable: true, value: host })
    try {
      if (host === '127.0.0.1') {
        await expect(ensureControlledIndexes()).resolves.toBeUndefined()
        spies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1))
      } else {
        await expect(ensureControlledIndexes()).rejects.toMatchObject({ code: 'CONTROLLED_ISOLATION_REQUIRED' })
        spies.forEach((spy) => expect(spy).not.toHaveBeenCalled())
      }
    } finally {
      spies.forEach((spy) => spy.mockRestore())
      if (descriptor) Object.defineProperty(mongoose.connection, 'host', descriptor)
      else delete mongoose.connection.host
    }
  })
})

const syntheticAuthority = () => {
  const providerDescriptor = { providerKey: 'openai', model: 'gpt-5.2', providerMode: 'LIVE_TEST', environment: 'TEST',
    safeContextPolicyKey: 'OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1', failurePosture: 'FAIL_CLOSED' }
  const objects = ['PROFESSIONAL_DOCUMENT', 'PRESENTATION', 'INFOGRAPHIC'].map((family, index) => {
    const bytes = Buffer.from(`%PDF-1.7 synthetic test ${family}\n%%EOF`)
    return { _id: `object-${index}`, bytes, sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.length, storageIdentity: `storage-${index}`, mimeType: 'application/pdf', extension: '.pdf' }
  })
  const revisions = objects.map((object, index) => ({ ...object, bytes: undefined, _id: `revision-${index}`, objectId: object._id,
    family: ['PROFESSIONAL_DOCUMENT', 'PRESENTATION', 'INFOGRAPHIC'][index], referenceKey: `reference-${index}`, revision: 2, status: 'APPROVED' }))
  const pointers = revisions.map((row) => ({ family: row.family, referenceKey: row.referenceKey,
    currentRevisionId: row._id, currentRevision: row.revision, currentStatus: row.status }))
  const revision = { _id: 'readiness-revision', registerId: 'oes-004-r2-slice-5-application-readiness-test', environment: 'TEST',
    revision: 5, policyVersion: 'OES_004_DEVELOPMENT_TEST_READINESS_V1', verdict: 'READY_FOR_TESTING',
    providerPolicy: providerDescriptor, testReferences: revisions.map((row) => ({ family: row.family, referenceKey: row.referenceKey,
      referenceRevision: row.revision, sha256: row.sha256, byteLength: row.byteLength, mimeType: row.mimeType })) }
  revision.contentHash = hashDevelopmentTestReadinessContent(revision)
  return { pointer: { registerId: revision.registerId, environment: 'TEST', currentRevisionId: revision._id, currentRevision: 5 },
    revision, pointers, revisions, objects, providerDescriptor }
}

describe('controlled governed authority and provider-free adapter boundary', () => {
  test('preserves existing readiness actor BSON identity and byte hash through canonical driver decoding', () => {
    const authority = syntheticAuthority()
    authority.revision.providerPolicy = { ...authority.revision.providerPolicy, decision: { recordedBy: { id: new mongoose.Types.ObjectId('041000000000000000000004') },
      recordedAt: new Date('2026-07-24T13:37:37.266Z') } }
    authority.revision.contentHash = hashDevelopmentTestReadinessContent(authority.revision)
    authority.objects.forEach((row) => { row.bytes = new mongoose.mongo.Binary(row.bytes) })
    authority.revisions.forEach((row) => { delete row.bytes })
    const encoded = EJSON.stringify(authority)
    const decoded = mongoose.mongo.BSON.EJSON.parse(encoded)
    expect(decoded.revision.providerPolicy.decision.recordedBy.id instanceof mongoose.Types.ObjectId).toBe(true)
    expect(validateControlledAuthority(decoded)).toBe(validateControlledAuthority(authority))
  })
  test('binds exact selected immutable authority and PDF bytes, rejects corruption or missing owner', () => {
    const authority = syntheticAuthority()
    expect(validateControlledAuthority(authority)).toBe(hashControlledAuthority(authority))
    const originalHash = hashControlledAuthority(authority)
    authority.objects[0].bytes[8] ^= 1
    expect(hashControlledAuthority(authority)).not.toBe(originalHash)
    expect(() => validateControlledAuthority(authority)).toThrow('PDF bytes invalid')
    expect(() => validateControlledAuthority({ ...syntheticAuthority(), objects: [] })).toThrow('authority binding invalid')
    const drift = syntheticAuthority(); drift.pointer.currentRevision = 6
    expect(() => validateControlledAuthority(drift)).toThrow('authority binding invalid')
    const policy = syntheticAuthority(); policy.providerDescriptor.model = 'different'
    expect(() => validateControlledAuthority(policy)).toThrow()
  })
  test('retains actual configured adapter version, reaches sentinel once and never calls original adapter', async () => {
    let networkCalls = 0
    const original = Object.assign(async () => { networkCalls++; throw Error('must never call') }, { configurationVersion: 'actual-frozen-version' })
    const stop = createControlledPreflightStopFactory(() => original)
    const adapter = stop.factory({})
    expect(adapter.configurationVersion).toBe(original.configurationVersion)
    await expect(adapter({ providerContext: {} })).rejects.toMatchObject({ code: 'CONTROLLED_PREFLIGHT_STOP' })
    expect(stop.snapshot()).toEqual({ boundaryCount: 1, providerConfigurationVersion: original.configurationVersion })
    expect(networkCalls).toBe(0)
    expect(() => createControlledPreflightStopFactory(() => original, () => ({ configurationVersion: 'changed' })).factory({})).toThrow('CONTROLLED_PROVIDER_VERSION_MISMATCH')
  })
})

const bindingFixture = (bsonLockActor = false) => {
  const ids = Object.fromEntries(['runtime', 'customer', 'tenant', 'actor', 'plan'].map((key, index) =>
    [key, new mongoose.Types.ObjectId(`04120000000000000000000${index + 1}`)]))
  const actor = String(ids.actor)
  const snapshotHash = 'a'.repeat(64)
  const runtime = { _id: ids.runtime, customerId: ids.customer, tenantId: ids.tenant,
    runtimeInstanceKey: 'controlled-binding-fixture', runtimeType: 'VALUE_NARRATIVE', frameworkKey: 'VMF',
    packageKey: 'controlled-binding-package', packageVersion: '1.0.0', status: 'LOCKED', updatedAt: new Date('2026-10-02T09:00:00.000Z'),
    framework_state: { sections: { customer_context: { state: { status: 'ACCEPTED' }, accepted: {
      sectionKey: 'customer-context', runtimePath: 'framework_state.sections.customer_context', truthHash: `sha256:${snapshotHash}`,
      acceptedAt: '2026-10-02T08:01:00.000Z', acceptedBy: actor, sourceActionKey: 'GENERATE_SECTION', sourceGeneratedAt: '2026-10-02T08:00:00.000Z',
    } } }, lock: { locked: true, state: 'LOCKED', lockedAt: '2026-10-02T09:00:00.000Z', lockedBy: bsonLockActor ? ids.actor : actor,
      publish: { snapshotId: 'controlled-publish', snapshotHash }, snapshot: { snapshotId: 'controlled-lock', snapshotHash },
      anchor: { replayAnchorId: 'controlled-replay', replayAnchorHash: snapshotHash },
      evidence: { dependencySnapshotId: 'controlled-dependency', dependencySnapshotHash: snapshotHash },
      outputEligibility: { canonicalOutputEligible: true },
    } } }
  const pack = (packType, packKey, knowledgeLayer, capabilityKey = '') => ({ activationId: `activation-${packKey}`,
    packId: `pack-${packKey}`, versionId: `version-${packKey}`, knowledgeAssetId: `QA-${packKey}`, packType, packKey, knowledgeLayer, capabilityKey,
    packCategory: packType === 'TRUTH_CERTIFICATION' ? 'PLATFORM' : 'OUTCOME', purposeCategory: 'SYSTEM',
    semanticVersion: '1.0.0', schemaVersion: '1.0.0', status: 'ACTIVE', scopeType: 'GLOBAL', scopeKey: 'GLOBAL',
    executionMode: packType === 'TRUTH_CERTIFICATION' ? 'POST_VALIDATION' : 'PROVIDER_CONTEXT', visibility: 'PLATFORM',
    workspaceCompatibility: ['OUTCOME'], contentHash: `sha256:${snapshotHash}`, relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
    relationshipChecksum: buildKnowledgePackRelationshipChecksum([]), relationshipGovernanceError: '', dependencyReferences: [] })
  const mandatory = [pack('ARL', 'adaptive-reasoning-layer', 'REASONING'), pack('TRUTH_CERTIFICATION', 'truth-certification-pack', 'VALIDATION')]
  const selected = [...mandatory, pack('OUTPUT_TYPE_DEFINITION', 'executive-brief', 'OUTPUT_TYPE', 'executive-brief'),
    pack('OUTPUT_SCHEMA', 'executive-brief-schema', 'OUTPUT_SCHEMA', 'executive-brief-schema'), pack('RL', 'expression-review', 'COMMUNICATION_PATTERN')]
  const binding = { status: 'READY', mode: 'REQUEST_SPECIFIC', policyKey: 'outcome-studio-v1-required-packs', policyVersion: '2.0.0',
    mandatorySafeguards: mandatory, selectedByLayer: { OUTPUT_TYPE: [selected[2]], OUTPUT_SCHEMA: [selected[3]], COMMUNICATION_PATTERN: [selected[4]] },
    excludedCandidates: [], blockedPacks: [], missingDependencies: [], relationshipFailures: [], ambiguousCandidates: [], incompatibleCandidates: [], warnings: [],
    dependencyGraph: { nodes: [], edges: [], cycles: [], depthOverflows: [] },
    lineage: { activationIds: selected.map((p) => p.activationId), versionIds: selected.map((p) => p.versionId), contentHashes: selected.map((p) => p.contentHash) },
    resolution: { request: { workspaceType: 'OUTCOME', requestedOutputTypeKey: 'executive-brief' }, scopeCandidates: [{ scopeKey: 'GLOBAL' }] } }
  // Reproduce the actual bounded control's clone boundary, preserving parent identity.
  const planningRuntime = { ...runtime, framework_state: { ...runtime.framework_state, lock: structuredClone(runtime.framework_state.lock) } }
  const candidate = buildOutcomeKnowledgeCompositionPlanCandidate({ runtime: planningRuntime, binding,
    context: { status: 'READY', available: true, requestedOutputTypeKey: 'executive-brief',
      outputType: { key: 'executive-brief', version: '1.0.0' }, outputSchema: { key: 'executive-brief-schema', version: '1.0.0' },
      warnings: [], lineage: {} },
    consumerIntent: { outcome: 'Controlled binding check', decisionPurpose: 'Verify governed identity', consumer: 'Synthetic reviewer',
      audience: ['Synthetic reviewer'], requestedOutputTypeKey: 'executive-brief', format: 'MARKDOWN', requirements: [], unresolvedGaps: [] } })
  const plan = { ...candidate, _id: ids.plan, planId: 'outcome_kcp_controlled_binding', planVersion: 1, operation: 'INITIAL',
    contractVersion: candidate.payload.contractVersion, customerId: ids.customer, tenantId: ids.tenant, runtimeInstanceId: ids.runtime,
    runtimeInstanceKey: runtime.runtimeInstanceKey, runtimeType: runtime.runtimeType, frameworkKey: runtime.frameworkKey,
    packageKey: runtime.packageKey, packageVersion: runtime.packageVersion, requestedOutputTypeKey: 'executive-brief',
    publishSnapshotId: candidate.payload.lockedTruth.publishSnapshotId, lockSnapshotId: candidate.payload.lockedTruth.lockSnapshotId,
    replayAnchorId: candidate.payload.lockedTruth.replayAnchorId, dependencySnapshotId: candidate.payload.lockedTruth.dependencySnapshotId }
  return { plan, runtime }
}

describe('SS-041 controlled replay isolation guards (no provider)', () => {
  test('canonical primitive actor survives the actual clone boundary and passes the unchanged runtime binding guard', () => {
    const fixture = bindingFixture()
    expect(assertControlledReplayRuntimeBinding(fixture).planFingerprint).toBe(fixture.plan.planFingerprint)
    expect(typeof fixture.plan.payload.lockedTruth.lockedBy).toBe('string')
  })
  test('the prior BSON lock defect, missing runtime, wrong scope and changed truth fail before any provider stage', () => {
    const old = bindingFixture(true)
    expect(old.plan.payload.lockedTruth.lockedBy).toBe('[object Object]')
    expect(() => assertControlledReplayRuntimeBinding(old)).toThrow(expect.objectContaining({ code: 'OUTCOME_KCP_RUNTIME_STALE', details: expect.objectContaining({ field: 'lockedTruthEvidence' }) }))
    const fixture = bindingFixture()
    expect(() => assertControlledReplayRuntimeBinding({ ...fixture, runtime: null })).toThrow(expect.objectContaining({ code: 'CONTROLLED_RUNTIME_UNAVAILABLE' }))
    expect(() => assertControlledReplayRuntimeBinding({ ...fixture, runtime: { ...fixture.runtime, customerId: new mongoose.Types.ObjectId() } }))
      .toThrow(expect.objectContaining({ code: 'OUTCOME_KCP_RUNTIME_STALE', details: expect.objectContaining({ field: 'runtimeScope' }) }))
    const changed = structuredClone(fixture.runtime.framework_state)
    changed.sections.customer_context.accepted.truthHash = `sha256:${'b'.repeat(64)}`
    expect(() => assertControlledReplayRuntimeBinding({ ...fixture, runtime: { ...fixture.runtime, framework_state: changed } }))
      .toThrow(expect.objectContaining({ code: 'OUTCOME_KCP_RUNTIME_STALE', details: expect.objectContaining({ field: 'lockedTruthEvidence' }) }))
  })
  test('ordinary provider-capable product routes cannot bypass the controlled latch', async () => {
    let productEntries = 0
    const runtime = 'a'.repeat(24), requestId = '11111111-1111-4111-8111-111111111111'
    const productApp = express()
    productApp.use((req, res) => { productEntries++; res.json({ reached: true, cookieForwarded: req.headers.cookie !== undefined,
      authorizationBridged: req.headers.authorization === 'Bearer synthetic.test.token' }) })
    const { app } = createControlledReplayApp({ productApp, identity: { runtimeInstanceId: runtime }, credentials: {},
      providerRuntime: { status: { configured: false } }, liveAuthorized: false })
    const base = `/api/v1/runtime-instances/${runtime}/outcome-studio`
    for (const path of [`${base}/sessions/${requestId}/messages/${requestId}/generate-response`,
      `${base}/quality-chain`, `${base}/requests/${requestId}/generate`, '/api/v1/auth/login',
      `/api/v1/runtime-instances/${'b'.repeat(24)}/outcome-studio/planning`]) {
      const response = await request(app).post(path).set('Host', CONTROLLED_HOST).set('Origin', CONTROLLED_ORIGIN).send({})
      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('CONTROLLED_ROUTE_NOT_ALLOWED')
    }
    expect(productEntries).toBe(0)
    const response = await request(app).post(`${base}/planning`).set('Host', CONTROLLED_HOST).set('Origin', CONTROLLED_ORIGIN)
      .set('Cookie', 'ss041_controlled_access=synthetic.test.token').send({})
    expect(response.status).toBe(200)
    expect(response.body.cookieForwarded).toBe(false)
    expect(response.body.authorizationBridged).toBe(true)
    expect(productEntries).toBe(1)
  })
  test('rejects missing/cross-site origins, non-JSON writes and alternate hosts', async () => {
    const app = express()
    app.use(controlledRequestGuard, express.json())
    app.post('/mutation', (_req, res) => res.json({ reached: true }))
    const allowed = await request(app).post('/mutation').set('Host', CONTROLLED_HOST).set('Origin', CONTROLLED_ORIGIN).send({})
    expect(allowed.status).toBe(200)
    for (const origin of [undefined, 'http://127.0.0.1:18081', 'https://example.test', 'null']) {
      let pending = request(app).post('/mutation').set('Host', CONTROLLED_HOST).send({})
      if (origin !== undefined) pending = pending.set('Origin', origin)
      expect((await pending).status).toBe(403)
    }
    expect((await request(app).post('/mutation').set('Host', CONTROLLED_HOST).set('Origin', CONTROLLED_ORIGIN).type('form').send('x=y')).status).toBe(403)
    expect((await request(app).post('/mutation').set('Host', 'localhost:18081').set('Origin', CONTROLLED_ORIGIN).send({})).status).toBe(403)
  })
  test('atomically consumes global replay before any awaited stage and never re-arms after failure', async () => {
    const latch = createSingleReplayLatch()
    let providerEntries = 0
    const enter = async (plan) => {
      if (!latch.consume(plan)) return 'READ_ONLY'
      await Promise.resolve()
      providerEntries++
      throw new Error('honest provider failure')
    }
    const results = await Promise.allSettled([enter('plan-one'), enter('plan-one'), enter('plan-two')])
    expect(results.map((row) => row.status)).toEqual(['rejected', 'fulfilled', 'fulfilled'])
    expect(providerEntries).toBe(1)
    expect(latch.snapshot()).toEqual({ consumed: true, planId: 'plan-one' })
    expect(await enter('plan-one')).toBe('READ_ONLY')
  })
  test('refuses existing databases and non-loopback identities before fixture writes', async () => {
    const old = { node: process.env.NODE_ENV, app: process.env.APP_ENV, fake: process.env.FAKE_AUTH_ENABLED }
    process.env.NODE_ENV = 'test'; process.env.APP_ENV = 'test'; process.env.FAKE_AUTH_ENABLED = 'false'
    try {
      const connection = { host: '127.0.0.1', name: 'ss041_po_replay_123', db: { listCollections: () => ({ toArray: async () => [] }) } }
      const uri = 'mongodb://127.0.0.1:28001/ss041_po_replay_123?replicaSet=ss041_po_replay'
      await expect(assertIsolatedReplayDatabase(connection, uri)).resolves.toBeUndefined()
      await expect(assertIsolatedReplayDatabase({ ...connection, host: 'shared.test' }, uri)).rejects.toMatchObject({ code: 'CONTROLLED_ISOLATION_REQUIRED' })
      await expect(assertIsolatedReplayDatabase({ ...connection, db: { listCollections: () => ({ toArray: async () => [{ name: 'old' }] }) } }, uri)).rejects.toMatchObject({ code: 'CONTROLLED_DATABASE_MUST_BE_FRESH' })
      await expect(assertIsolatedReplayDatabase(connection, 'mongodb://127.0.0.1:28001/shared')).rejects.toMatchObject({ code: 'CONTROLLED_ISOLATION_REQUIRED' })
    } finally {
      for (const [key, value] of Object.entries({ NODE_ENV: old.node, APP_ENV: old.app, FAKE_AUTH_ENABLED: old.fake })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value
      }
    }
  })
})
