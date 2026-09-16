import mongoose from 'mongoose'
import assert from 'node:assert/strict'
const uri = process.env.KCP_ISOLATION_TEST_URI
if (!uri || !/^mongodb:\/\/127\.0\.0\.1:\d+\/kcp_isolation_\d+\?replicaSet=kcp_isolation$/.test(uri)
  || uri !== process.env.MONGODB_URI) throw new Error('Exact loopback replica URI required')
if (process.env.NODE_ENV !== 'test' || process.env.FAKE_AUTH_ENABLED !== 'false'
  || process.env.OUTCOME_STUDIO_PROVIDER_ENABLED !== 'false'
  || process.env.JWT_SECRET !== 'synthetic-planning-browser-access-secret-long'
  || process.env.JWT_REFRESH_SECRET !== 'synthetic-planning-browser-refresh-secret-long'
  || process.env.AUDIT_SIGNATURE_SECRET !== 'synthetic-kcp-isolation-audit-secret') throw new Error('Synthetic launcher environment required')
let server
const stop = async () => {
  if (server?.listening) await new Promise((resolve) => server.close(resolve))
  await mongoose.disconnect()
  globalThis.fetch = originalFetch
}
mongoose.set('autoIndex', false)
mongoose.set('autoCreate', false)
const originalFetch = globalThis.fetch
globalThis.fetch = (url, ...args) => {
  if (new URL(String(url)).hostname !== '127.0.0.1') throw new Error('Outbound access forbidden in planning fixture')
  return originalFetch(url, ...args)
}
try {
await mongoose.connect(uri, { autoIndex: false, autoCreate: false })
const { seedPlanningBrowserFixture } = await import('./outcomePlanningBrowserFixture.mjs')
const identity = await seedPlanningBrowserFixture()
const { default: app } = await import('../src/app.js')
server = app.listen(18080, '127.0.0.1')
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
const base = 'http://127.0.0.1:18080/api/v1'
const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: identity.email, password: identity.password }) })
const auth = await login.json()
if (!login.ok || !auth.data?.accessToken) throw new Error(`Synthetic normal login failed: ${login.status} ${JSON.stringify(auth.error || {})}`)
const headers = { Authorization: `Bearer ${auth.data.accessToken}`, 'Content-Type': 'application/json' }
const endpoint = `${base}/runtime-instances/${identity.runtimeInstanceId}/outcome-studio`
const scope = `?customerId=${identity.customerId}&tenantId=${identity.tenantId}`
for (const path of ['', '/readiness']) {
  const response = await fetch(`${endpoint}${path}${scope}`, { headers })
  if (!response.ok) throw new Error(`Workspace bootstrap failed: ${path || 'studio'} ${response.status}`)
}
const endpointB = `${base}/runtime-instances/${identity.otherScope.runtimeInstanceId}/outcome-studio`
const scopeB = `?customerId=${identity.otherScope.customerId}&tenantId=${identity.otherScope.tenantId}`
const step = async (prompt, continuation, target = endpoint, selection = scope) => {
  const response = await fetch(`${target}/planning${selection}`, { method: 'POST', headers, body: JSON.stringify({ prompt, ...(continuation ? { continuation } : {}) }) })
  const body = await response.json()
  if (!response.ok) throw new Error(`Planning fixture preflight failed: ${response.status} ${JSON.stringify(body.error)}`)
  return body.data
}
let result = await step('Executive brief')
if (result.status !== 'CLARIFICATION_REQUIRED') throw new Error(`Expected real discovery: ${JSON.stringify(result)}`)
for (const prompt of ['Explain the opportunity', 'Approve next steps', 'Sponsor', 'Board', 'Accessible PDF', 'skip', 'Plain language']) result = await step(prompt, result.continuation)
if (result.status !== 'CONFIRMATION_REQUIRED') throw new Error(`Expected confirmed facts preview: ${result.status}`)
const { OutcomeKnowledgeCompositionPlan, OutcomeSession, OutcomeMessage, AuditLog } = await import('../src/models/index.js')
if (await OutcomeKnowledgeCompositionPlan.countDocuments() || await OutcomeSession.countDocuments() || await OutcomeMessage.countDocuments()) throw new Error('Preview unexpectedly persisted customer artifacts')
console.log(JSON.stringify({ browserFixtureReady: true, api: base, ...identity,
  preflight: 'normal password login + actual auth/router/repository/resolver clarification to preview; zero plans/sessions/messages',
  provider: 'disabled; outbound fetch forbidden', note: 'Synthetic local credentials only; no live account' }))
if (!process.argv.includes('--serve')) {
  let previewB = await step('Executive brief', undefined, endpointB, scopeB)
  assert.equal(previewB.status, 'CLARIFICATION_REQUIRED')
  for (const prompt of ['Explain the opportunity', 'Approve next steps', 'Sponsor', 'Board', 'Accessible PDF', 'skip', 'Plain language']) previewB = await step(prompt, previewB.continuation, endpointB, scopeB)
  assert.equal(previewB.status, 'CONFIRMATION_REQUIRED')
  const { RuntimeInstance } = await import('../src/models/index.js')
  const creationAudits = () => AuditLog.countDocuments({ action: 'OUTCOME_KNOWLEDGE_COMPOSITION_PLAN_CREATED' })
  const snapshot = async () => {
    const collections = [RuntimeInstance.collection, mongoose.connection.collection('runtime_section_states'), OutcomeKnowledgeCompositionPlan.collection, OutcomeSession.collection, OutcomeMessage.collection]
    return { documents: JSON.stringify(await Promise.all(collections.map((collection) => collection.find({}).sort({ _id: 1 }).toArray()))), creationAudits: await creationAudits() }
  }
  const denied = async (url, payload, status, code) => {
    const before = await snapshot()
    const response = await fetch(url, { headers, ...(payload ? { method: 'POST', body: JSON.stringify(payload) } : {}) })
    const body = await response.json()
    assert.equal(response.status, status)
    assert.equal(typeof body.error.requestId, 'string')
    assert.equal(body.error.requestId, body.meta.requestId)
    assert.deepEqual(body.error, { requestId: body.meta.requestId, code, message: 'Outcome planning is blocked. Check the request or retry after the required evidence is available.', details: { reason: code, execution: { status: 'BLOCKED', canExecute: false } } })
    assert.deepEqual(Object.keys(body).sort(), ['error', 'meta'])
    for (const value of [result.continuation, result.requestId, identity.runtimeInstanceId, identity.customerId, identity.tenantId, ...Object.values(identity.otherScope)]) assert.equal(JSON.stringify(body).includes(value), false)
    assert.deepEqual(await snapshot(), before)
  }
  await denied(`${endpointB}/planning${scopeB}`, { prompt: 'Plain language', continuation: result.continuation }, 403, 'OUTCOME_PLANNING_SCOPE_MISMATCH')
  await denied(`${endpointB}/requests/${result.requestId}/plans${scopeB}`, { continuation: result.continuation, confirm: true }, 403, 'OUTCOME_PLANNING_SCOPE_MISMATCH')
  await denied(`${endpoint}/planning${scopeB}`, { prompt: 'Executive brief' }, 404, 'OUTCOME_PLANNING_UNAVAILABLE')
  const confirmation = { continuation: result.continuation, confirm: true }
  const url = `${endpoint}/requests/${result.requestId}/plans${scope}`
  const beforeAudits = await AuditLog.countDocuments()
  const beforeCreationAudits = await creationAudits()
  const saveResponse = await fetch(url, { method: 'POST', headers, body: JSON.stringify(confirmation) })
  const saved = await saveResponse.json()
  if (!saveResponse.ok) throw new Error(`Real confirmation failed: ${saveResponse.status} ${JSON.stringify(saved.error || {})}`)
  if (saved.data?.status !== 'SAVED' || saved.data.execution?.canExecute !== false) throw new Error('Invalid saved projection')
  await denied(`${endpointB}/requests/${result.requestId}/plans/${saved.data.plan.planId}${scopeB}`, undefined, 404, 'OUTCOME_PLANNING_UNAVAILABLE')
  const retry = await (await fetch(url, { method: 'POST', headers, body: JSON.stringify(confirmation) })).json()
  if (retry.data?.plan?.planId !== saved.data.plan.planId || retry.data.plan.idempotent !== true) throw new Error('Exact retry did not reuse plan')
  const retrieval = await fetch(`${endpoint}/requests/${result.requestId}/plans/${saved.data.plan.planId}${scope}`, { headers })
  if (!retrieval.ok || (await retrieval.json()).data?.plan?.planId !== saved.data.plan.planId) throw new Error('Real retrieval failed')
  for (const substituted of [result.requestId, saved.data.plan.planId]) {
    const attempt = await fetch(`${endpoint}/sessions/${substituted}/messages/${substituted}/generate-response${scope}`, { method: 'POST', headers, body: '{}' })
    if (attempt.status !== 404) throw new Error(`Substituted plan identity generation must be missing session, got ${attempt.status}`)
  }
  if (await OutcomeKnowledgeCompositionPlan.countDocuments() !== 1 || await AuditLog.countDocuments() !== beforeAudits + 1
    || await OutcomeSession.countDocuments() || await OutcomeMessage.countDocuments()) throw new Error('Unexpected persistence after retry or substituted generation')
  assert.equal(await creationAudits(), beforeCreationAudits + 1)
  console.log(JSON.stringify({ sharedCustomerIsolation: 'PASS', authorizedPreviews: ['A', 'B'], exactDenials: 4, fullDocumentNoWriteSnapshots: true, creationAudits: 1 }))
  console.log(JSON.stringify({ normalApiVerification: 'PASS', exactRetry: true, scopedRetrieval: true,
    substitutedRequestAndPlanIdsRejected: true, plans: 1, newAudits: 1, sessions: 0, messages: 0 }))
  await stop()
} else {
  process.on('SIGTERM', () => { void stop().then(() => process.exit(0)) })
  process.on('SIGINT', () => { void stop().then(() => process.exit(0)) })
}
} catch (error) {
  await stop()
  throw error
}
