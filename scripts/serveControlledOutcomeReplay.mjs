// Isolated PO evidence transport. Never imported by the product application.
import express from 'express'
import fs from 'node:fs'
import mongoose from 'mongoose'
import { randomUUID } from 'node:crypto'
import authJwt from '../src/middleware/authJwt.js'
import loadScopes from '../src/middleware/loadScopes.js'
import requestContext from '../src/middleware/requestContext.js'
import { login } from '../src/controllers/auth.controller.js'
import { assertRuntimePermission } from '../src/services/runtimeInstanceService.js'
import { OutcomeKnowledgeCompositionPlan, OutcomeQualityStageExecution,
  GovernedReasoningExecution, GovernedRuntimeArtifact, RuntimeInstance } from '../src/models/index.js'
import { assertOutcomeKnowledgeCompositionPlanIntegrity, assertOutcomeKnowledgeCompositionPlanMatchesRuntime } from '../src/services/outcomeKnowledgeCompositionPlanService.js'
import { assertRuntimeEvidenceToMeaningReady, projectRuntimeEvidenceToMeaningReadiness, readRuntimeEvidenceToMeaningContract } from '../src/services/outcomeRuntimeEvidenceToMeaningService.js'
import { getRuntimeOutcomeEvidenceContractSnapshot } from '../src/services/runtimeStateRepository.js'
import { compileEvidenceToMeaningContract } from '../src/services/outcomeEvidenceToMeaningContractService.js'
import { executeOutcomeFrameworkGuidance } from '../src/services/outcomeFrameworkGuidanceExecutionService.js'
import { executeOutcomeWorkingDraft } from '../src/services/outcomeWorkingDraftExecutionService.js'
import { approveOutcomeWorkingDraftMeaning } from '../src/services/outcomeArlMeaningReviewService.js'
import { normalizeOutcomeArlProviderReview } from '../src/services/outcomeArlReviewContract.js'
import { buildRuntimeStateRequestScopes } from '../src/controllers/runtimeInstance.controller.js'
import { buildOutcomeStudioProviderRuntime } from '../src/config/outcomeStudioProvider.js'
import { createHash } from 'node:crypto'
import { validateRuntimeIntelligenceGraph, buildRuntimeIntelligenceGraphProjection,
  buildRuntimeIntelligenceGraphQueryProjection } from '../src/services/runtimeIntelligenceGraphService.js'

export const CONTROLLED_ORIGIN = 'http://127.0.0.2:18081'
export const CONTROLLED_HOST = '127.0.0.2:18081'
const cookieName = 'ss041_controlled_access'
const reject = (code, status = 409) => Object.assign(new Error(code), { code, status })
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const hash = /^[a-f0-9]{64}$/
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const createControlledPreflightStopFactory = (configuredFactory, comparisonFactory = configuredFactory) => {
  let boundaryCount = 0
  let providerConfigurationVersion = ''
  return {
    factory(args) {
      const configured = configuredFactory(args)
      providerConfigurationVersion = configured.configurationVersion
      if (!providerConfigurationVersion || comparisonFactory(args).configurationVersion !== providerConfigurationVersion) throw reject('CONTROLLED_PROVIDER_VERSION_MISMATCH')
      const adapter = async () => { boundaryCount++; throw reject('CONTROLLED_PREFLIGHT_STOP') }
      Object.defineProperty(adapter, 'configurationVersion', { value: providerConfigurationVersion })
      return adapter
    },
    snapshot: () => ({ boundaryCount, providerConfigurationVersion }),
  }
}

export const assertControlledReplayRuntimeBinding = ({ plan, runtime }) => {
  if (!runtime) throw reject('CONTROLLED_RUNTIME_UNAVAILABLE')
  return assertOutcomeKnowledgeCompositionPlanMatchesRuntime(plan, runtime)
}

export const assertIsolatedReplayDatabase = async (connection, uri) => {
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/ss041_po_replay_\d+\?replicaSet=ss041_po_replay$/.test(uri || '')
    || connection.host !== '127.0.0.1' || !/^ss041_po_replay_\d+$/.test(connection.name)
    || process.env.NODE_ENV !== 'test' || process.env.APP_ENV !== 'test'
    || process.env.FAKE_AUTH_ENABLED !== 'false') throw reject('CONTROLLED_ISOLATION_REQUIRED')
  if ((await connection.db.listCollections().toArray()).length) throw reject('CONTROLLED_DATABASE_MUST_BE_FRESH')
}

// Synchronous consumption is intentionally before any awaited stage or history read.
export const createSingleReplayLatch = () => {
  let consumed = false
  let identity = null
  return Object.freeze({
    consume(key) {
      if (consumed) return false
      consumed = true
      identity = key
      return true
    },
    snapshot: () => ({ consumed, planId: identity }),
  })
}

export const controlledRequestGuard = (req, res, next) => {
  if (req.headers.host !== CONTROLLED_HOST) return res.status(403).json({ error: { code: 'CONTROLLED_HOST_REQUIRED' } })
  if (!['GET', 'HEAD'].includes(req.method)
    && (req.headers.origin !== CONTROLLED_ORIGIN || !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || ''))) {
    return res.status(403).json({ error: { code: 'CONTROLLED_ORIGIN_JSON_REQUIRED' } })
  }
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  next()
}

const cookieBridge = (req, _res, next) => {
  const value = (req.headers.cookie || '').split(';').map((item) => item.trim())
    .find((item) => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
  // The bridge transports a genuine normal-login token; authJwt still verifies it.
  if (value && /^[A-Za-z0-9_.-]+$/.test(value)) req.headers.authorization = `Bearer ${value}`
  // Product request logging already redacts Authorization; never forward cookies.
  delete req.headers.cookie
  next()
}
const safeStage = (row) => ({ stageKey: row.stageKey, stageExecutionId: row.stageExecutionId,
  status: row.status, attemptNumber: row.attemptNumber, attemptFingerprint: row.attemptFingerprint,
  predecessorStageExecutionId: row.predecessorStageExecutionId, predecessorAttemptFingerprint: row.predecessorAttemptFingerprint,
  inputFingerprint: row.inputFingerprint, outputFingerprint: row.outputFingerprint,
  governedReasoningExecutionId: row.executionIdentity?.grrExecutionId,
  governedRuntimeArtifactId: row.executionIdentity?.grrRuntimeArtifactId,
  ...(row.stageKey === 'WORKING_DRAFT' && row.status === 'SUCCEEDED' ? { workingDraft: {
    title: row.outputSnapshot.title,
    sections: (row.outputSnapshot.sections || []).map((section) => ({ sectionKey: section.sectionKey,
      title: section.title, content: section.content, claims: (section.claims || []).map((claim) => ({
        claimKey: claim.claimKey, statement: claim.statement, truthReferences: claim.truthReferences,
      })) })),
  } } : {}),
  ...(row.stageKey === 'ARL_MEANING_REVIEW' && row.status === 'SUCCEEDED' ? { meaningReview: row.outputSnapshot } : {}),
  ...(row.failure ? { failureCode: row.failure.failureCode } : {}),
})

export const createControlledReplayApp = ({ productApp, identity, credentials, providerRuntime, pagePath,
  liveAuthorized = false }) => {
  const app = express()
  const latch = createSingleReplayLatch()
  let terminalFailure = null
  let successfulPreflight = null
  app.use(controlledRequestGuard, express.json({ limit: '32kb' }), requestContext, cookieBridge)
  app.get('/', (_req, res) => {
    res.type('html').setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'")
    res.send(fs.readFileSync(pagePath, 'utf8'))
  })
  app.get('/controlled/identity', (_req, res) => res.json({ evidenceClass: 'CONTROLLED_SYNTHETIC_SOURCE',
    runtimeInstanceId: identity.runtimeInstanceId, customerId: identity.customerId, tenantId: identity.tenantId,
    outputTypeKey: identity.outputTypeKey, sourceCount: identity.sourceCount, evidenceCount: identity.evidenceCount,
    frozenSourceHash: identity.frozenSourceHash, targetReceiptFingerprint: identity.targetReceiptFingerprint,
    graphHash: identity.graphHash, governedAuthorityHash: identity.governedAuthorityHash,
    environment: { runtimeRevision: identity.runtimeRevision, apiCommit: identity.apiCommit,
      database: mongoose.connection.name, databaseHost: mongoose.connection.host, origin: CONTROLLED_ORIGIN,
      appEnvironment: 'test', evidenceSource: 'Controlled frozen synthetic fixture' },
    providerConfigured: providerRuntime.status.configured, liveAuthorized, latch: latch.snapshot() }))
  app.post('/controlled/login', (req, res, next) => {
    req.body = { email: credentials.email, password: credentials.password }
    const respond = res.json.bind(res)
    res.json = (body) => {
      if (!body?.data?.accessToken) return respond(body)
      res.setHeader('Set-Cookie', `${cookieName}=${body.data.accessToken}; HttpOnly; SameSite=Strict; Path=/`)
      return respond({ authenticated: true, evidenceClass: 'CONTROLLED_SYNTHETIC_ACCOUNT' })
    }
    return login(req, res, next)
  })
  const selectControlledScope = (req, _res, next) => {
    try {
      if (req.query.customerId !== identity.customerId || req.query.tenantId !== identity.tenantId) throw reject('CONTROLLED_SCOPE_REQUIRED', 403)
      req.scopes = buildRuntimeStateRequestScopes({ scopes: req.scopes, query: req.query })
      next()
    } catch (error) { next(error) }
  }
  const authenticate = [authJwt, loadScopes, selectControlledScope]
  const authorize = async (req) => {
    if (String(req.context.userId) !== identity.actorUserId) throw reject('CONTROLLED_ACTOR_REQUIRED', 403)
    await assertRuntimePermission({ actorUserId: req.context.userId, scopes: req.scopes,
      customerId: identity.customerId, tenantId: identity.tenantId, permission: 'VMF_UPDATE' })
  }
  const findPlan = async (values, requireFingerprint = false) => {
    if (!uuid.test(values.requestId || '') || !/^outcome_kcp_[a-f0-9-]{36}$/.test(values.planId || '')
      || ((requireFingerprint || values.planFingerprint !== undefined) && !hash.test(values.planFingerprint || ''))) throw reject('CONTROLLED_IDENTITY_INVALID', 422)
    const scope = { runtimeInstanceId: identity.runtimeInstanceId, customerId: identity.customerId, tenantId: identity.tenantId, requestId: values.requestId }
    const plan = await OutcomeKnowledgeCompositionPlan.findOne({ ...scope, planId: values.planId,
      ...(values.planFingerprint ? { planFingerprint: values.planFingerprint } : {}) }).lean()
    const latest = await OutcomeKnowledgeCompositionPlan.findOne(scope).sort({ planVersion: -1 }).lean()
    if (!plan || latest?.planId !== plan.planId) throw reject('CONTROLLED_PLAN_NOT_CURRENT')
    assertOutcomeKnowledgeCompositionPlanIntegrity(plan)
    return plan
  }
  const assertPersistedRuntimeBinding = async (plan) => {
    const runtime = await RuntimeInstance.findOne({ _id: identity.runtimeInstanceId,
      customerId: identity.customerId, tenantId: identity.tenantId }).lean()
    return assertControlledReplayRuntimeBinding({ plan, runtime })
  }
  const assertCurrentGraph = async () => {
    const runtime = await RuntimeInstance.findOne({ _id: identity.runtimeInstanceId,
      customerId: identity.customerId, tenantId: identity.tenantId }).lean()
    const graph = runtime?.framework_state?.intelligence_graph
    if (!graph || graph.graphHash !== identity.graphHash || validateRuntimeIntelligenceGraph(graph).length
      || !buildRuntimeIntelligenceGraphQueryProjection(buildRuntimeIntelligenceGraphProjection(graph), 'readiness').available) throw reject('CONTROLLED_GRAPH_BINDING_INVALID')
  }
  const readback = async (plan, scopes) => {
    const stages = await OutcomeQualityStageExecution.find({ runtimeInstanceId: identity.runtimeInstanceId,
      requestId: plan.requestId, planId: plan.planId }).sort({ stageOrder: 1, attemptNumber: 1 }).lean()
    const projectedStages = await Promise.all(stages.map(async (stage) => {
      const projected = safeStage(stage)
      if (stage.stageKey === 'ARL_MEANING_REVIEW' && stage.executionIdentity?.grrRuntimeArtifactId) {
        const artifact = await GovernedRuntimeArtifact.findOne({ runtimeInstanceId: identity.runtimeInstanceId,
          customerId: identity.customerId, tenantId: identity.tenantId,
          runtimeArtifactId: stage.executionIdentity.grrRuntimeArtifactId,
          executionId: stage.executionIdentity.grrExecutionId }).select('generatedOutput').lean()
        if (artifact) projected.providerMeaningReview = normalizeOutcomeArlProviderReview(artifact.generatedOutput)
      }
      return projected
    }))
    let runtimeBinding = { status: 'FAIL', reason: 'NOT_REVALIDATED' }
    try { await assertPersistedRuntimeBinding(plan); runtimeBinding = { status: 'PASS', reason: 'PERSISTED_KCP_MATCHES_CURRENT_RUNTIME' } }
    catch (error) { runtimeBinding = { status: 'FAIL', reason: error.code || 'RUNTIME_BINDING_FAILED', field: error.details?.field || 'runtime' } }
    let sourceCurrentness = { current: false, reason: 'NOT_REVALIDATED' }
    try { await assertRuntimeEvidenceToMeaningReady({ plan, scopes }); sourceCurrentness = { current: true, reason: 'SOURCE_SNAPSHOT_MATCHES_FROZEN_RECEIPT' } }
    catch (error) { sourceCurrentness = { current: false, reason: error.details?.reason || 'SOURCE_REVALIDATION_FAILED' } }
    const currentness = runtimeBinding.status === 'PASS' ? sourceCurrentness
      : { current: false, reason: runtimeBinding.reason, field: runtimeBinding.field }
    if (!currentness.current) currentness.nextAction = 'Re-resolve a fresh request against the current controlled source and runtime.'
    return { evidenceClass: 'CONTROLLED_SYNTHETIC_SOURCE_REAL_ISOLATED_PERSISTENCE', requestId: plan.requestId,
      planId: plan.planId, planFingerprint: plan.planFingerprint, readiness: projectRuntimeEvidenceToMeaningReadiness(plan),
      runtimeBindingStatus: runtimeBinding.status, runtimeBinding, sourceCurrentness, currentness,
      stages: projectedStages, latch: latch.snapshot(), terminalFailure,
      governedReasoningCount: await GovernedReasoningExecution.countDocuments({ runtimeInstanceId: identity.runtimeInstanceId }),
      governedArtifactCount: await GovernedRuntimeArtifact.countDocuments({ runtimeInstanceId: identity.runtimeInstanceId }) }
  }
  const route = (handler) => async (req, res, next) => { try { await authorize(req); await handler(req, res) } catch (error) { next(error) } }
  app.get('/controlled/readback', ...authenticate, route(async (req, res) => res.json(await readback(await findPlan(req.query), req.scopes))))
  app.post('/controlled/preflight', ...authenticate, route(async (req, res) => {
    const plan = await findPlan(req.body, true)
    await assertPersistedRuntimeBinding(plan)
    await assertRuntimeEvidenceToMeaningReady({ plan, scopes: req.scopes })
    await assertCurrentGraph()
    const collections = ['outcome_quality_stage_executions', 'governed_reasoning_executions', 'governed_runtime_artifacts',
      'outcome_drafts', 'outcome_draft_iterations', 'outcome_assets', 'outcome_asset_versions', 'outcome_render_outputs', 'auditlogs']
    const counts = async () => Object.fromEntries(await Promise.all(collections.map(async (name) => [name,
      await mongoose.connection.db.collection(name).countDocuments({})])))
    const before = await counts()
    if (before.outcome_quality_stage_executions || before.governed_reasoning_executions) throw reject('CONTROLLED_ATTEMPT_HISTORY_EXISTS')
    let networkCalls = 0
    const probeRuntime = buildOutcomeStudioProviderRuntime({ fetchImpl: async () => {
      networkCalls++; throw reject('CONTROLLED_NETWORK_FORBIDDEN')
    } })
    if (!probeRuntime.status.configured || !providerRuntime.status.configured
      || digest(probeRuntime.deps.providerDescriptor) !== digest(providerRuntime.deps.providerDescriptor)) throw reject('CONTROLLED_PROVIDER_HELD')
    const stop = createControlledPreflightStopFactory(probeRuntime.deps.frameworkGuidanceProviderAdapterFactory,
      providerRuntime.deps.frameworkGuidanceProviderAdapterFactory)
    let stopped = false
    let failureCode = ''
    try {
      await executeOutcomeFrameworkGuidance({ actorUserId: req.context.userId, auditRequest: req,
        planRecordId: String(plan._id), expectedPlanFingerprint: plan.planFingerprint,
        runtimeInstanceId: identity.runtimeInstanceId, scopes: req.scopes,
        requestBinding: { requestId: plan.requestId, draftId: `outcome_draft_${randomUUID()}`, draftIterationId: `outcome_draft_iteration_${randomUUID()}` },
        providerDescriptor: probeRuntime.deps.providerDescriptor, providerAdapterFactory: stop.factory })
    } catch (error) {
      stopped = error.code === 'CONTROLLED_PREFLIGHT_STOP'
      failureCode = /^[A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'CONTROLLED_PREFLIGHT_FAILED'
    }
    const after = await counts()
    const countsUnchanged = JSON.stringify(before) === JSON.stringify(after)
    const boundary = stop.snapshot()
    const passed = stopped && boundary.boundaryCount === 1 && networkCalls === 0 && countsUnchanged
    const contract = readRuntimeEvidenceToMeaningContract(plan)
    const receipt = { requestId: plan.requestId, planId: plan.planId,
      planFingerprint: plan.planFingerprint, contractHash: contract.contractHash,
      runtimeBindingStatus: 'PASS', sourceCurrentness: { current: true, reason: 'SOURCE_SNAPSHOT_MATCHES_FROZEN_RECEIPT' },
      graphHash: identity.graphHash, configurationHash: identity.packManifest.configurationHash,
      governedAuthorityHash: identity.governedAuthorityHash, providerDescriptorHash: digest(probeRuntime.deps.providerDescriptor),
      ...boundary, networkCalls, countsUnchanged }
    successfulPreflight = passed ? receipt : null
    return res.json({ preProviderBoundaryStatus: passed ? 'PASS' : 'FAIL',
      ...(passed ? {} : { failureCode }), preflightReceipt: receipt, persistenceCounts: { before, after } })
  }))
  app.post('/controlled/execute', ...authenticate, route(async (req, res) => {
    if (!liveAuthorized || !providerRuntime.status.configured) throw reject('CONTROLLED_PROVIDER_HELD', 403)
    const selected = await findPlan(req.body, true)
    const currentContract = await assertRuntimeEvidenceToMeaningReady({ plan: selected, scopes: req.scopes })
    await assertPersistedRuntimeBinding(selected)
    await assertCurrentGraph()
    if (!successfulPreflight || successfulPreflight.planId !== selected.planId
      || successfulPreflight.planFingerprint !== selected.planFingerprint || successfulPreflight.contractHash !== currentContract.contractHash
      || successfulPreflight.graphHash !== identity.graphHash || successfulPreflight.configurationHash !== identity.packManifest.configurationHash
      || successfulPreflight.governedAuthorityHash !== identity.governedAuthorityHash
      || successfulPreflight.providerDescriptorHash !== digest(providerRuntime.deps.providerDescriptor)) throw reject('CONTROLLED_PREFLIGHT_REQUIRED')
    // Even a failed eligibility/provider check never re-arms the one-attempt latch.
    if (!latch.consume(req.body.planId)) return res.json(await readback(await findPlan(req.body, true), req.scopes))
    const plan = await findPlan(req.body, true)
    if (await OutcomeQualityStageExecution.exists({ runtimeInstanceId: identity.runtimeInstanceId })) throw reject('CONTROLLED_ATTEMPT_HISTORY_EXISTS')
    if (await GovernedReasoningExecution.exists({ runtimeInstanceId: identity.runtimeInstanceId })) throw reject('CONTROLLED_REASONING_HISTORY_EXISTS')
    try {
      await assertPersistedRuntimeBinding(plan)
      await assertRuntimeEvidenceToMeaningReady({ plan, scopes: req.scopes })
      const requestBinding = { requestId: plan.requestId, draftId: `outcome_draft_${randomUUID()}`, draftIterationId: `outcome_draft_iteration_${randomUUID()}` }
      const common = { actorUserId: req.context.userId, auditRequest: req, planRecordId: String(plan._id),
        expectedPlanFingerprint: plan.planFingerprint, runtimeInstanceId: identity.runtimeInstanceId,
        scopes: req.scopes, requestBinding, providerDescriptor: providerRuntime.deps.providerDescriptor }
      const fg = await executeOutcomeFrameworkGuidance({ ...common, providerAdapterFactory: providerRuntime.deps.frameworkGuidanceProviderAdapterFactory })
      if (fg.stage.status !== 'SUCCEEDED') return res.json(await readback(plan, req.scopes))
      const wd = await executeOutcomeWorkingDraft({ ...common, providerAdapter: providerRuntime.deps.workingDraftProviderAdapterFactory() })
      if (wd.stage.status !== 'SUCCEEDED') return res.json(await readback(plan, req.scopes))
      await approveOutcomeWorkingDraftMeaning({ ...common, providerAdapter: providerRuntime.deps.arlMeaningReviewProviderAdapterFactory() })
      // Deliberately no Narrative Plan, shaping, RL, rendering or final response writer.
      return res.json(await readback(plan, req.scopes))
    } catch (error) {
      terminalFailure = { code: /^[A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'CONTROLLED_EXECUTION_FAILED' }
      return res.json(await readback(plan, req.scopes))
    }
  }))
  let driftConsumed = false
  app.post('/controlled/drift/check', ...authenticate, route(async (req, res) => {
    if (driftConsumed) throw reject('CONTROLLED_DRIFT_ALREADY_RECORDED')
    driftConsumed = true
    const plan = await findPlan(req.body, true)
    const contract = readRuntimeEvidenceToMeaningContract(plan)
    const scope = { runtimeInstanceId: new mongoose.Types.ObjectId(identity.runtimeInstanceId),
      customerId: new mongoose.Types.ObjectId(identity.customerId), tenantId: new mongoose.Types.ObjectId(identity.tenantId), current: true }
    const evidence = mongoose.connection.collection('runtime_evidence_objects')
    const row = await evidence.findOne(scope)
    if (!row) throw reject('CONTROLLED_SOURCE_UNAVAILABLE')
    await evidence.updateOne({ ...scope, _id: row._id }, { $set: { sourceLocation: `${row.sourceLocation}#controlled-drift` } })
    const snapshot = await getRuntimeOutcomeEvidenceContractSnapshot({ runtimeInstanceId: identity.runtimeInstanceId, scopes: req.scopes })
    const fresh = compileEvidenceToMeaningContract({ ...contract.inputs, sourceSnapshot: snapshot })
    const after = await readback(plan, req.scopes)
    if (after.currentness.current || fresh.contractHash === contract.contractHash) throw reject('CONTROLLED_DRIFT_NOT_DETECTED')
    res.json({ ...after, oldContractHash: contract.contractHash, newContractHash: fresh.contractHash,
      sourceChanged: true, nextAction: 'Re-resolve a fresh request; the saved receipt and Working Draft remain historical evidence.' })
  }))
  // The product app exposes more provider-capable paths. This transport permits
  // only its real planning/confirmation/retrieval routes, never ordinary Generate.
  app.use((req, res, next) => {
    const path = /^\/api\/v1\/runtime-instances\/[a-f0-9]{24}\/outcome-studio\/(planning|requests\/[a-f0-9-]{36}\/plans(?:\/outcome_kcp_[a-f0-9-]{36})?)$/.exec(req.path)
    const allowed = path && req.path.startsWith(`/api/v1/runtime-instances/${identity.runtimeInstanceId}/outcome-studio/`)
      && (req.method === 'POST' && (path[1] === 'planning' || /\/plans$/.test(path[1]))
      || req.method === 'GET' && /\/plans\/outcome_kcp_/.test(path[1]))
    if (!allowed) return res.status(403).json({ error: { code: 'CONTROLLED_ROUTE_NOT_ALLOWED' } })
    next()
  }, productApp)
  app.use((error, _req, res, _next) => res.status(error.status || 409).json({ error: { code: error.code || 'CONTROLLED_REQUEST_BLOCKED' } }))
  return { app, latch }
}

export const ensureControlledIndexes = async () => {
  if (mongoose.connection.host !== '127.0.0.1') throw reject('CONTROLLED_ISOLATION_REQUIRED')
  for (const model of [OutcomeKnowledgeCompositionPlan, OutcomeQualityStageExecution, GovernedReasoningExecution, GovernedRuntimeArtifact]) {
    await model.createCollection()
    await model.createIndexes()
  }
}
