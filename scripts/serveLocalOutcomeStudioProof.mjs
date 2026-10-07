// Local engineering transport only; native product controllers remain execution owners.
import express from 'express'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import mongoose from 'mongoose'
import authJwt from '../src/middleware/authJwt.js'
import loadScopes from '../src/middleware/loadScopes.js'
import requestContext from '../src/middleware/requestContext.js'
import { buildRuntimeStateRequestScopes } from '../src/controllers/runtimeInstance.controller.js'
import { assertRuntimePermission } from '../src/services/runtimeInstanceService.js'
import { OutcomeSession, OutcomeMessage, OutcomeKnowledgeCompositionPlan, RuntimeInstance,
  OutcomeQualityStageExecution, GovernedReasoningExecution } from '../src/models/index.js'
import { assertOutcomeKnowledgeCompositionPlanIntegrity, assertOutcomeKnowledgeCompositionPlanMatchesRuntime } from '../src/services/outcomeKnowledgeCompositionPlanService.js'
import { assertRuntimeEvidenceToMeaningReady, projectRuntimeEvidenceToMeaningReadiness,
  readRuntimeEvidenceToMeaningContract } from '../src/services/outcomeRuntimeEvidenceToMeaningService.js'
import { executeOutcomeFrameworkGuidance } from '../src/services/outcomeFrameworkGuidanceExecutionService.js'
import { buildOutcomeStudioProviderRuntime } from '../src/config/outcomeStudioProvider.js'
import { validateRuntimeIntelligenceGraph, buildRuntimeIntelligenceGraphProjection,
  buildRuntimeIntelligenceGraphQueryProjection } from '../src/services/runtimeIntelligenceGraphService.js'
import { createSingleReplayLatch, createControlledPreflightStopFactory } from './serveControlledOutcomeReplay.mjs'

export const LOCAL_PROOF_ORIGIN = 'http://127.0.0.2:5176'
export const LOCAL_PROOF_HOST = '127.0.0.2:18082'
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const reject = (code, status = 409) => Object.assign(new Error(code), { code, status })
const id = '[A-Za-z0-9_-]{1,120}'
const collections = ['outcome_quality_stage_executions', 'governed_reasoning_executions',
  'governed_runtime_artifacts', 'outcome_drafts', 'outcome_draft_iterations', 'outcome_assets',
  'outcome_asset_versions', 'outcome_render_outputs', 'auditlogs']

export const classifyLocalProofRoute = (method, pathname, identity) => {
  if (method === 'OPTIONS') return classifyLocalProofRoute('GET', pathname, identity)
    || classifyLocalProofRoute('POST', pathname, identity)
  if (method === 'POST' && /^\/api\/v1\/auth\/(login|refresh|logout)$/.test(pathname)) return 'auth'
  if (method === 'GET' && pathname === '/api/v1/auth/me') return 'read'
  if (method === 'GET' && /^\/local-proof\/(identity|readback)$/.test(pathname)) return 'control'
  if (method === 'POST' && /^\/local-proof\/(preflight|drift)$/.test(pathname)) return 'control'
  if (method !== 'GET' && method !== 'POST') return null
  const runtime = `/api/v1/runtime-instances/${identity.runtimeInstanceId}`
  const studio = `${runtime}/outcome-studio`
  if (method === 'POST') {
    if ([`${studio}/planning`, `${studio}/sessions`].includes(pathname)
      || new RegExp(`^${studio}/requests/${id}/plans$`).test(pathname)
      || new RegExp(`^${studio}/sessions/${id}/messages$`).test(pathname)) return 'write'
    if (new RegExp(`^${studio}/sessions/${id}/messages/${id}/generate-response$`).test(pathname)) return 'generate'
    return null
  }
  const customer = `/api/v1/customers/${identity.customerId}`
  if (['/api/v1/customers', customer, `${customer}/credits`, `${customer}/tenants`, `${customer}/tenants/${identity.tenantId}`,
    `/api/v1/tenants/${identity.tenantId}`, '/api/v1/runtime-instances', '/api/v1/runtime-instances/activity',
    '/api/v1/runtime-instances/framework-packages', runtime, `${runtime}/summary`,
    `${runtime}/renderer`, `${runtime}/state/bootstrap`, `${runtime}/state/graph-manifest`,
    `${runtime}/state/graph-projection`, `${runtime}/state/outcome-handoff/readiness`,
    `${runtime}/output-lab/definitions`, studio, `${studio}/readiness`,
    `${studio}/commercial-strategy-decision-paper/readiness`].includes(pathname)) return 'read'
  return [new RegExp(`^${studio}/requests/${id}/plans/${id}$`),
    new RegExp(`^${studio}/sessions/${id}(?:/assets)?$`),
    new RegExp(`^${studio}/assets/${id}(?:/preview|/versions/${id})?$`),
    new RegExp(`^${studio}/sessions/${id}/drafts/${id}/(?:preview|compare)$`)]
    .some((pattern) => pattern.test(pathname)) ? 'read' : null
}

export const createLocalProofBoundaryGuard = (identity) => (req, res, next) => {
  const route = classifyLocalProofRoute(req.method, req.path, identity)
  if (req.headers.host !== LOCAL_PROOF_HOST || !route) return res.status(403).json({ error: { code: 'LOCAL_PROOF_ROUTE_DENIED' } })
  if (!['GET', 'OPTIONS'].includes(req.method) && (req.headers.origin !== LOCAL_PROOF_ORIGIN
    || !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || ''))) {
    return res.status(403).json({ error: { code: 'LOCAL_PROOF_ORIGIN_JSON_REQUIRED' } })
  }
  if (req.headers.origin && req.headers.origin !== LOCAL_PROOF_ORIGIN) return res.status(403).json({ error: { code: 'LOCAL_PROOF_ORIGIN_REQUIRED' } })
  res.setHeader('Access-Control-Allow-Origin', LOCAL_PROOF_ORIGIN)
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID, API-Version')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  delete req.headers.cookie
  req.localProofRoute = route
  next()
}

export const createLocalOutcomeStudioProofApp = ({ productApp, identity, providerRuntime,
  manifest, verifyManifest, reviewPath, deps = {} }) => {
  const app = express()
  const latch = createSingleReplayLatch()
  let successfulPreflight = null
  let driftConsumed = false
  const counts = deps.counts || (async () => Object.fromEntries(await Promise.all(collections.map(async (name) =>
    [name, await mongoose.connection.collection(name).countDocuments({})]))))
  const models = deps.models || { OutcomeSession, OutcomeMessage, OutcomeKnowledgeCompositionPlan, RuntimeInstance }
  const authenticate = deps.authenticate || [authJwt, loadScopes]
  app.use(createLocalProofBoundaryGuard(identity), express.json({ limit: '64kb' }), requestContext)
  app.use((req, res, next) => {
    if (['/api/v1/auth/login', '/api/v1/auth/refresh'].includes(req.path)) return next()
    return authenticate.reduceRight((continuation, middleware) => (error) => error
      ? next(error) : middleware(req, res, continuation), next)()
  })
  const scope = { runtimeInstanceId: identity.runtimeInstanceId, customerId: identity.customerId, tenantId: identity.tenantId }
  const scoped = async (req) => {
    if (String(req.context?.userId) !== identity.actorUserId) throw reject('LOCAL_PROOF_ACTOR_REQUIRED', 403)
    if ((req.query.customerId && req.query.customerId !== identity.customerId)
      || (req.query.tenantId && req.query.tenantId !== identity.tenantId)) throw reject('LOCAL_PROOF_SCOPE_REQUIRED', 403)
    if (req.path.startsWith('/local-proof/') || req.path.includes('/outcome-studio')) {
      if (req.query.customerId !== identity.customerId || req.query.tenantId !== identity.tenantId) throw reject('LOCAL_PROOF_SCOPE_REQUIRED', 403)
      req.scopes = buildRuntimeStateRequestScopes({ scopes: req.scopes, query: req.query })
    }
    await (deps.assertPermission || assertRuntimePermission)({ actorUserId: req.context.userId,
      scopes: req.scopes, customerId: identity.customerId, tenantId: identity.tenantId, permission: 'VMF_UPDATE' })
  }
  const findPlan = async (values) => {
    if (!/^[a-f0-9-]{36}$/.test(values.requestId || '') || !/^outcome_kcp_[a-f0-9-]{36}$/.test(values.planId || '')) throw reject('LOCAL_PROOF_IDENTITY_INVALID', 422)
    const plan = await models.OutcomeKnowledgeCompositionPlan.findOne({ ...scope, requestId: values.requestId,
      planId: values.planId, ...(values.planFingerprint ? { planFingerprint: values.planFingerprint } : {}) }).lean()
    const latest = await models.OutcomeKnowledgeCompositionPlan.findOne({ ...scope, requestId: values.requestId }).sort({ planVersion: -1 }).lean()
    if (!plan || latest?.planId !== plan.planId) throw reject('LOCAL_PROOF_PLAN_NOT_CURRENT')
    ;(deps.assertPlan || assertOutcomeKnowledgeCompositionPlanIntegrity)(plan)
    return plan
  }
  const assertCurrent = async (plan, req) => {
    const runtime = await models.RuntimeInstance.findOne({ _id: identity.runtimeInstanceId,
      customerId: identity.customerId, tenantId: identity.tenantId }).lean()
    ;(deps.assertRuntime || assertOutcomeKnowledgeCompositionPlanMatchesRuntime)(plan, runtime)
    const contract = await (deps.assertEvidence || assertRuntimeEvidenceToMeaningReady)({ plan, scopes: req.scopes })
    const graph = runtime?.framework_state?.intelligence_graph
    if (!graph || graph.graphHash !== identity.graphHash || validateRuntimeIntelligenceGraph(graph).length
      || !buildRuntimeIntelligenceGraphQueryProjection(buildRuntimeIntelligenceGraphProjection(graph), 'readiness').available) throw reject('LOCAL_PROOF_GRAPH_INVALID')
    verifyManifest()
    return contract
  }
  const route = (handler) => async (req, res, next) => {
    try { await scoped(req); await handler(req, res, next) } catch (error) { next(error) }
  }
  app.get('/local-proof/identity', route(async (_req, res) => res.json({ evidenceClass: 'SOURCE_MANIFEST_LOCAL_UNCOMMITTED_ONLY',
    ...scope, actorUserId: identity.actorUserId, sourceManifestHash: manifest.sourceManifestHash,
    clientRevision: manifest.clientRevision, evidenceCount: identity.evidenceCount, latch: latch.snapshot() })))
  app.get('/local-proof/readback', route(async (req, res) => {
    const plan = await findPlan(req.query)
    let currentness
    try { await assertCurrent(plan, req); currentness = { current: true } }
    catch (error) { currentness = { current: false, reason: error.code || 'LOCAL_PROOF_CURRENTNESS_FAILED' } }
    const stages = await OutcomeQualityStageExecution.find({ ...scope, planId: plan.planId }).sort({ stageOrder: 1, attemptNumber: 1 })
      .select('stageKey stageExecutionId status attemptNumber inputFingerprint outputFingerprint predecessorStageExecutionId predecessorAttemptFingerprint executionIdentity.grrExecutionId executionIdentity.grrRuntimeArtifactId failure.failureCode').lean()
    res.json({ requestId: plan.requestId, planId: plan.planId, planFingerprint: plan.planFingerprint,
      readiness: projectRuntimeEvidenceToMeaningReadiness(plan), currentness, stages, counts: await counts(),
      preflight: successfulPreflight, latch: latch.snapshot() })
  }))
  app.post('/local-proof/preflight', route(async (req, res) => {
    successfulPreflight = null
    const plan = await findPlan(req.body)
    const contract = await assertCurrent(plan, req)
    const before = await counts()
    if (before.outcome_quality_stage_executions || before.governed_reasoning_executions || latch.snapshot().consumed) throw reject('LOCAL_PROOF_ATTEMPT_HISTORY_EXISTS')
    let networkCalls = 0
    const probe = (deps.buildProviderRuntime || buildOutcomeStudioProviderRuntime)({ fetchImpl: async () => { networkCalls++; throw reject('LOCAL_PROOF_NETWORK_FORBIDDEN') } })
    if (!probe.status.configured || !providerRuntime.status.configured
      || digest(probe.deps.providerDescriptor) !== digest(providerRuntime.deps.providerDescriptor)) throw reject('LOCAL_PROOF_PROVIDER_NOT_CONFIGURED')
    const stop = createControlledPreflightStopFactory(probe.deps.frameworkGuidanceProviderAdapterFactory,
      providerRuntime.deps.frameworkGuidanceProviderAdapterFactory)
    let stopped = false
    try {
      await (deps.executeFrameworkGuidance || executeOutcomeFrameworkGuidance)({ actorUserId: req.context.userId, auditRequest: req,
        planRecordId: String(plan._id), expectedPlanFingerprint: plan.planFingerprint, ...scope, scopes: req.scopes,
        requestBinding: { requestId: plan.requestId, draftId: 'local_proof_preflight_draft', draftIterationId: 'local_proof_preflight_iteration' },
        providerDescriptor: probe.deps.providerDescriptor, providerAdapterFactory: stop.factory })
    } catch (error) { if (error.code !== 'CONTROLLED_PREFLIGHT_STOP') throw error; stopped = true }
    const after = await counts()
    if (!stopped || stop.snapshot().boundaryCount !== 1 || networkCalls !== 0 || digest(before) !== digest(after)) throw reject('LOCAL_PROOF_PREFLIGHT_FAILED')
    successfulPreflight = { requestId: plan.requestId, planId: plan.planId, planFingerprint: plan.planFingerprint,
      contractHash: contract.contractHash, runtimeBindingStatus: 'PASS', sourceCurrentness: { current: true },
      sourceManifestHash: manifest.sourceManifestHash, clientRevision: manifest.clientRevision,
      graphHash: identity.graphHash, configurationHash: identity.packManifest.configurationHash,
      governedAuthorityHash: identity.governedAuthorityHash, frozenSourceHash: identity.frozenSourceHash,
      providerDescriptorHash: digest(probe.deps.providerDescriptor), ...stop.snapshot(), networkCalls, countsUnchanged: true }
    res.json({ preProviderBoundaryStatus: 'PASS', preflightReceipt: successfulPreflight })
  }))
  app.post('/local-proof/drift', route(async (req, res) => {
    await findPlan(req.body)
    if (driftConsumed) throw reject('LOCAL_PROOF_DRIFT_ALREADY_CONSUMED')
    driftConsumed = true
    successfulPreflight = null
    const filter = Object.fromEntries(Object.entries(scope).map(([key, value]) => [key, new mongoose.Types.ObjectId(value)]))
    const evidence = mongoose.connection.collection('runtime_evidence_objects')
    const row = await evidence.findOne({ ...filter, current: true })
    if (!row) throw reject('LOCAL_PROOF_SOURCE_MISSING')
    await evidence.updateOne({ _id: row._id, ...filter }, { $set: { sourceLocation: `${row.sourceLocation}#local-proof-drift` } })
    res.json({ changed: true, nextAction: 'Re-resolve the request; the historical receipt remains unchanged.' })
  }))
  app.use(async (req, res, next) => {
    try {
      if (['/api/v1/auth/login', '/api/v1/auth/refresh'].includes(req.path)) return next()
      await scoped(req)
      const sessionMatch = req.path.match(/\/sessions\/([^/]+)/)
      let session
      if (sessionMatch) {
        session = await models.OutcomeSession.findOne({ ...scope, sessionId: sessionMatch[1] }).lean()
        if (!session) throw reject('LOCAL_PROOF_SESSION_NOT_SCOPED', 403)
      }
      if (req.localProofRoute !== 'generate') return next()
      if (!providerRuntime.status.configured) throw reject('LOCAL_PROOF_PROVIDER_NOT_CONFIGURED')
      if (latch.snapshot().consumed) throw reject('LOCAL_PROOF_ATTEMPT_ALREADY_CONSUMED')
      const messageId = req.path.match(/\/messages\/([^/]+)\/generate-response$/)?.[1]
      const message = await models.OutcomeMessage.findOne({ ...scope, sessionId: session.sessionId, messageId }).lean()
      if (!message) throw reject('LOCAL_PROOF_MESSAGE_NOT_SCOPED', 403)
      const plan = await findPlan(session.contextBindings?.requestPlan || {})
      const contract = await assertCurrent(plan, req)
      if (!successfulPreflight || successfulPreflight.planId !== plan.planId
        || successfulPreflight.planFingerprint !== plan.planFingerprint || successfulPreflight.contractHash !== contract.contractHash
        || successfulPreflight.providerDescriptorHash !== digest(providerRuntime.deps.providerDescriptor)) throw reject('LOCAL_PROOF_PREFLIGHT_REQUIRED')
      const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8').replace(/^\uFEFF/, ''))
      if (review.decision !== 'PASS' || review.score < 0.9 || review.providerEligibility !== 'AUTHORIZED_FOR_ONE_ROOT_DISPATCH'
        || review.evidenceClass !== 'SOURCE_MANIFEST_LOCAL_UNCOMMITTED_ONLY'
        || digest(review.preflightReceipt) !== digest(successfulPreflight)) throw reject('LOCAL_PROOF_INDEPENDENT_CERTIFICATE_REQUIRED')
      const histories = await (deps.countAttempts || (async () => (await OutcomeQualityStageExecution.countDocuments(scope))
        + (await GovernedReasoningExecution.countDocuments(scope))))()
      if (histories || !latch.consume(plan.planId)) throw reject('LOCAL_PROOF_ATTEMPT_ALREADY_CONSUMED')
      // Native controller/factories perform actual FG, WD, ARL and any authorized existing continuation.
      return next()
    } catch (error) { return next(error) }
  })
  app.use(productApp)
  app.use((error, _req, res, _next) => res.status(error.status || 409).json({ error: { code: /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'LOCAL_PROOF_GUARD_FAILED' } }))
  return { app, latch }
}
