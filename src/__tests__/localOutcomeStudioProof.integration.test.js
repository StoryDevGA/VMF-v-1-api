import { describe, test, expect } from '@jest/globals'
import express from 'express'
import request from 'supertest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildRuntimeIntelligenceGraphForFrameworkState } from '../services/runtimeIntelligenceGraphService.js'
import { classifyLocalProofRoute, createLocalProofBoundaryGuard, createLocalOutcomeStudioProofApp,
  LOCAL_PROOF_ORIGIN, LOCAL_PROOF_HOST } from '../../scripts/serveLocalOutcomeStudioProof.mjs'
import { createSingleReplayLatch } from '../../scripts/serveControlledOutcomeReplay.mjs'

const identity = { runtimeInstanceId: '041000000000000000000003', customerId: '041000000000000000000001',
  tenantId: '041000000000000000000002', actorUserId: '041000000000000000000004', graphHash: 'a'.repeat(64) }
const runtime = `/api/v1/runtime-instances/${identity.runtimeInstanceId}`
const studio = `${runtime}/outcome-studio`
const boundaryApp = () => {
  const app = express()
  app.use(createLocalProofBoundaryGuard(identity))
  app.use((_req, res) => res.json({ forwarded: true }))
  return app
}
const browser = (call) => call.set('Host', LOCAL_PROOF_HOST).set('Origin', LOCAL_PROOF_ORIGIN)

describe('normal application local-proof transport boundaries', () => {
  test.each(['planning', 'sessions', 'requests/request/plans', 'sessions/session/messages',
    'sessions/session/messages/message/generate-response'])('allows only declared native write %s', (suffix) => {
    expect(classifyLocalProofRoute('POST', `${studio}/${suffix}`, identity)).toBeTruthy()
  })
  test.each(['governed-reasoning/executions', 'output-lab/requests', 'data', 'discovery-reset',
    'outcome-studio/assets/asset/publish', 'outcome-studio/assets/asset/render/pdf',
    'outcome-studio/sessions/session/drafts/draft/approve'])('denies undeclared native write %s', async (suffix) => {
    const result = await browser(request(boundaryApp()).post(`${runtime}/${suffix}`)).send({})
    expect(result.status).toBe(403)
  })
  test.each(['outcome-studio/assets/asset/export/pdf', 'outcome-studio/assets/asset/render/pdf',
    'governed-reasoning/executions/execution', 'output-lab/requests/request/generate'])('denies unmatched provider-capable GET %s', (suffix) => {
    expect(classifyLocalProofRoute('GET', `${runtime}/${suffix}`, identity)).toBeNull()
  })
  test('rejects host/origin/no-origin/non-JSON and different runtime, allows narrowly matched CORS preflight', async () => {
    const app = boundaryApp()
    expect((await request(app).get(studio)).status).toBe(403)
    expect((await request(app).post(`${studio}/planning`).set('Host', LOCAL_PROOF_HOST).send({})).status).toBe(403)
    expect((await request(app).post(`${studio}/planning`).set('Host', LOCAL_PROOF_HOST).set('Origin', 'http://127.0.0.1:5173').send({})).status).toBe(403)
    expect((await browser(request(app).post(`${studio}/planning`)).type('text').send('{}')).status).toBe(403)
    expect((await browser(request(app).get(studio.replace(identity.runtimeInstanceId, 'other')))).status).toBe(403)
    expect((await browser(request(app).options(`${studio}/planning`))).status).toBe(204)
    expect((await browser(request(app).options('/api/v1/auth/super-admin/login'))).status).toBe(403)
    expect((await browser(request(app).head(studio))).status).toBe(403)
  })
  test('propagates ordinary authentication error before any permission or product forwarding', async () => {
    let forwarded = 0
    let permissionCalls = 0
    const product = express(); product.use((_req, res) => { forwarded++; res.sendStatus(200) })
    const { app } = createLocalOutcomeStudioProofApp({ productApp: product, identity, providerRuntime: {}, manifest: {},
      verifyManifest: () => {}, reviewPath: 'never-read', deps: {
        authenticate: [(_req, _res, next) => next(Object.assign(Error('denied'), { status: 401, code: 'UNAUTHORIZED' }))],
        assertPermission: async () => { permissionCalls++ },
      } })
    const result = await browser(request(app).get(studio))
    expect(result.status).toBe(401)
    expect(result.body.error.code).toBe('UNAUTHORIZED')
    expect(forwarded).toBe(0); expect(permissionCalls).toBe(0)
  })
  test('ordinary login delegates unchanged credentials to product auth, never rewrites user input', async () => {
    const product = express(); product.post('/api/v1/auth/login', (req, res) => res.json({ email: req.body.email }))
    const { app } = createLocalOutcomeStudioProofApp({ productApp: product, identity, providerRuntime: {}, manifest: {},
      verifyManifest: () => {}, reviewPath: 'never-read', deps: { authenticate: [() => { throw Error('must not bypass native login') }] } })
    const result = await browser(request(app).post('/api/v1/auth/login')).send({ email: 'synthetic@example.test', password: 'synthetic-only' })
    expect(result.status).toBe(200); expect(result.body.email).toBe('synthetic@example.test')
  })
  test('rejects authenticated wrong actor and cross-scope controls before native operations', async () => {
    let operations = 0
    const product = express(); product.use((_req, res) => { operations++; res.sendStatus(200) })
    const build = (actor) => createLocalOutcomeStudioProofApp({ productApp: product, identity, providerRuntime: {}, manifest: {},
      verifyManifest: () => {}, reviewPath: 'never-read', deps: { authenticate: [(req, _res, next) => {
        req.context = { userId: actor }; req.scopes = {}; next()
      }], assertPermission: async () => {} } }).app
    const query = `?customerId=${identity.customerId}&tenantId=${identity.tenantId}`
    expect((await browser(request(build('different')).get(`/local-proof/readback${query}`))).status).toBe(403)
    expect((await browser(request(build(identity.actorUserId)).post('/local-proof/preflight?customerId=other')).send({})).status).toBe(403)
    expect(operations).toBe(0)
  })
  test('normal session Generate rejects unscoped stored session before certificate/provider dispatch', async () => {
    let operations = 0
    const product = express(); product.use((_req, res) => { operations++; res.sendStatus(200) })
    const { app } = createLocalOutcomeStudioProofApp({ productApp: product, identity, providerRuntime: {}, manifest: {},
      verifyManifest: () => {}, reviewPath: 'never-read', deps: { authenticate: [(req, _res, next) => {
        req.context = { userId: identity.actorUserId }; req.scopes = {}; next()
      }], assertPermission: async () => {}, models: { OutcomeSession: { findOne: () => ({ lean: async () => null }) } } } })
    const result = await browser(request(app).post(`${studio}/sessions/session/messages/message/generate-response?customerId=${identity.customerId}&tenantId=${identity.tenantId}`)).send({})
    expect(result.status).toBe(403); expect(result.body.error.code).toBe('LOCAL_PROOF_SESSION_NOT_SCOPED')
    expect(operations).toBe(0)
  })
  test('atomic global latch permits one dispatcher across concurrent plans and never re-arms', async () => {
    const latch = createSingleReplayLatch()
    const attempts = await Promise.all(Array.from({ length: 30 }, (_, index) => Promise.resolve().then(() => latch.consume(`plan-${index}`))))
    expect(attempts.filter(Boolean)).toHaveLength(1)
    expect(latch.snapshot()).toEqual({ consumed: true, planId: 'plan-0' })
    expect(latch.consume('plan-0')).toBe(false)
  })
})

// Dependency-injected integration oracle for the full transport guard. No provider
// output is invented and these tests make no real FG/WD/ARL acceptance claim.
const integratedGuard = () => {
  const graph = buildRuntimeIntelligenceGraphForFrameworkState({ frameworkPackage: {
    frameworkKey: 'FIXTURE', packageKey: 'fixture-package', version: '1.0.0', sections: [] },
  frameworkState: { sections: {} }, runtimeInstance: { _id: identity.runtimeInstanceId,
    runtimeInstanceKey: 'fixture-runtime', runtimeType: 'VALUE_NARRATIVE', frameworkKey: 'FIXTURE',
    packageKey: 'fixture-package', packageVersion: '1.0.0', customerId: identity.customerId, tenantId: identity.tenantId } })
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'local-proof-guard-test-'))
  const reviewPath = path.join(directory, 'review.json')
  const requestId = '11111111-1111-4111-8111-111111111111'
  const plan = { _id: 'unit-plan', requestId, planId: 'outcome_kcp_22222222-2222-4222-8222-222222222222',
    planFingerprint: 'a'.repeat(64) }
  const control = { forwarded: 0, messageMissing: false, planMissing: false, stale: false, histories: 0,
    mutateCounts: false, forbiddenNetwork: false, manifestStale: false, providerConfigured: true }
  const adapter = Object.assign(async () => { throw Error('original adapter must never run') }, { configurationVersion: 'unit-version' })
  const providerRuntime = { status: { configured: true }, deps: { providerDescriptor: { providerKey: 'unit-only' },
    frameworkGuidanceProviderAdapterFactory: () => adapter } }
  const query = (value) => ({ lean: async () => value, sort: () => ({ lean: async () => value }) })
  let capturedFetch
  let countReads = 0
  const product = express(); product.use((_req, res) => { control.forwarded++; res.json({ nativeForwarded: true }) })
  const fixture = { ...identity, graphHash: graph.graphHash, packManifest: { configurationHash: 'b'.repeat(64) },
    governedAuthorityHash: 'c'.repeat(64), frozenSourceHash: 'd'.repeat(64) }
  const { app, latch } = createLocalOutcomeStudioProofApp({ productApp: product, identity: fixture, providerRuntime,
    manifest: { sourceManifestHash: 'e'.repeat(64), clientRevision: 'unit-client' }, reviewPath,
    verifyManifest: () => { if (control.manifestStale) throw Object.assign(Error('changed'), { code: 'SOURCE_CHANGED' }) },
    deps: { authenticate: [(req, _res, next) => { req.context = { userId: identity.actorUserId }; req.scopes = {}; next() }],
      assertPermission: async () => {}, assertPlan: () => {}, assertRuntime: () => {},
      assertEvidence: async () => { if (control.stale) throw Object.assign(Error('stale'), { code: 'SOURCE_STALE' }); return { contractHash: 'f'.repeat(64) } },
      models: { OutcomeSession: { findOne: () => query({ sessionId: 'session', contextBindings: { requestPlan: plan } }) },
        OutcomeMessage: { findOne: () => query(control.messageMissing ? null : { messageId: 'message' }) },
        OutcomeKnowledgeCompositionPlan: { findOne: () => query(control.planMissing ? null : plan) },
        RuntimeInstance: { findOne: () => query({ framework_state: { intelligence_graph: graph } }) } },
      countAttempts: async () => { await Promise.resolve(); return control.histories },
      counts: async () => { countReads++; return { outcome_quality_stage_executions: 0, governed_reasoning_executions: 0,
        auditlogs: control.mutateCounts && countReads > 1 ? 1 : 0 } },
      buildProviderRuntime: ({ fetchImpl }) => { capturedFetch = fetchImpl; return { ...providerRuntime,
        status: { configured: control.providerConfigured } } },
      executeFrameworkGuidance: async ({ providerAdapterFactory }) => {
        if (control.forbiddenNetwork) return capturedFetch()
        return providerAdapterFactory({})({})
      },
    } })
  const scopeQuery = `?customerId=${identity.customerId}&tenantId=${identity.tenantId}`
  return { app, latch, control, directory, plan, providerRuntime,
    preflight: () => browser(request(app).post(`/local-proof/preflight${scopeQuery}`)).send(plan),
    generate: () => browser(request(app).post(`${studio}/sessions/session/messages/message/generate-response${scopeQuery}`)).send({}),
    certify: (receipt, overrides = {}) => fs.writeFileSync(reviewPath, JSON.stringify({ decision: 'PASS', score: 0.95,
      providerEligibility: 'AUTHORIZED_FOR_ONE_ROOT_DISPATCH', evidenceClass: 'SOURCE_MANIFEST_LOCAL_UNCOMMITTED_ONLY',
      preflightReceipt: receipt, ...overrides })),
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
  }
}

describe('integrated normal Generate prerequisite and one-dispatch guard', () => {
  test('requires successful same-plan preflight before native forwarding', async () => {
    const fixture = integratedGuard()
    try { const result = await fixture.generate(); expect(result.status).toBe(409)
      expect(result.body.error.code).toBe('LOCAL_PROOF_PREFLIGHT_REQUIRED'); expect(fixture.control.forwarded).toBe(0) }
    finally { fixture.cleanup() }
  })
  test.each(['missing', 'invalid', 'different-plan'])('rejects %s certificate without consuming latch', async (kind) => {
    const fixture = integratedGuard()
    try {
      const probe = await fixture.preflight(); expect(probe.status).toBe(200)
      const receipt = probe.body.preflightReceipt
      if (kind === 'invalid') fixture.certify(receipt, { decision: 'FAIL' })
      if (kind === 'different-plan') fixture.certify({ ...receipt, planId: 'different-plan' })
      expect((await fixture.generate()).status).toBe(409)
      expect(fixture.control.forwarded).toBe(0); expect(fixture.latch.snapshot().consumed).toBe(false)
    } finally { fixture.cleanup() }
  })
  test.each(['messageMissing', 'planMissing', 'stale', 'manifestStale', 'histories'])('rejects changed authoritative %s before dispatch', async (field) => {
    const fixture = integratedGuard()
    try {
      const probe = await fixture.preflight(); expect(probe.status).toBe(200); fixture.certify(probe.body.preflightReceipt)
      fixture.control[field] = field === 'histories' ? 1 : true
      expect((await fixture.generate()).status).toBeGreaterThanOrEqual(400)
      expect(fixture.control.forwarded).toBe(0); expect(fixture.latch.snapshot().consumed).toBe(false)
    } finally { fixture.cleanup() }
  })
  test.each(['providerConfigured', 'forbiddenNetwork', 'mutateCounts'])('preflight rejects %s with no eligible native dispatch', async (field) => {
    const fixture = integratedGuard()
    try {
      fixture.control[field] = field === 'providerConfigured' ? false : true
      expect((await fixture.preflight()).status).toBeGreaterThanOrEqual(400)
      expect((await fixture.generate()).status).toBe(409)
      expect(fixture.control.forwarded).toBe(0)
    } finally { fixture.cleanup() }
  })
  test('full async native Generate guard atomically forwards once and rejects refresh/repeated requests', async () => {
    const fixture = integratedGuard()
    try {
      const probe = await fixture.preflight(); expect(probe.status).toBe(200)
      expect(probe.body.preflightReceipt).toMatchObject({ boundaryCount: 1, networkCalls: 0, countsUnchanged: true })
      fixture.certify(probe.body.preflightReceipt)
      const responses = await Promise.all(Array.from({ length: 8 }, () => fixture.generate()))
      expect(responses.filter((result) => result.status === 200)).toHaveLength(1)
      expect(responses.filter((result) => result.status === 409)).toHaveLength(7)
      expect(fixture.control.forwarded).toBe(1)
      expect((await fixture.generate()).status).toBe(409)
      expect((await fixture.preflight()).status).toBe(409)
    } finally { fixture.cleanup() }
  })
  test('provider becoming held and a subsequent failed probe cannot retain old eligibility', async () => {
    const fixture = integratedGuard()
    try {
      const probe = await fixture.preflight(); expect(probe.status).toBe(200); fixture.certify(probe.body.preflightReceipt)
      fixture.providerRuntime.status.configured = false
      expect((await fixture.generate()).body.error.code).toBe('LOCAL_PROOF_PROVIDER_NOT_CONFIGURED')
      fixture.providerRuntime.status.configured = true
      fixture.control.forbiddenNetwork = true
      expect((await fixture.preflight()).status).toBe(409)
      fixture.control.forbiddenNetwork = false
      expect((await fixture.generate()).body.error.code).toBe('LOCAL_PROOF_PREFLIGHT_REQUIRED')
      expect(fixture.control.forwarded).toBe(0)
    } finally { fixture.cleanup() }
  })
})
