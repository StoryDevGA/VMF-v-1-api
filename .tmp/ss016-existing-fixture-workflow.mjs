import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import mongoose from 'mongoose'
mongoose.set('autoCreate', false)
mongoose.set('autoIndex', false)
const { default: env } = await import('../src/config/env.js')
assert.ok(['development', 'test'].includes(env.appEnv) && !env.isAppProduction)
const { connectDb, disconnectDb } = await import('../src/config/db.js')
const { RuntimeInstance, User, OutcomeSession, OutcomeMessage, OutcomeDraft, OutcomeAssetVersion } = await import('../src/models/index.js')
const { buildUserPermissionsSnapshot } = await import('../src/services/performanceCacheService.js')
const { executeRuntimeAction } = await import('../src/services/runtimeActionExecutionService.js')
const { getRuntimeStateOutcomeHandoffReadiness } = await import('../src/services/runtimeStateRepository.js')
const outcome = await import('../src/services/outcomeStudioService.js')
const { buildOutcomeStudioProviderRuntime } = await import('../src/config/outcomeStudioProvider.js')
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex')
const truth = r => ({ evidence: r.framework_state.evidence_pack, accepted: Object.fromEntries(Object.entries(r.framework_state.sections).map(([k, s]) => [k, s.accepted])) })
const key = process.argv[4] || 'ss017-vmf-v315-proof'
const evidenceCounts = { 'ss017-vmf-v315-proof': 8, 'ss016-fresh-discovery-proof': 5 }
assert.ok(Object.hasOwn(evidenceCounts, key), 'Explicit synthetic runtime allowlist required')
const stage = process.argv[2] || 'plan'
assert.ok(['plan', 'lifecycle', 'request', 'clarify', 'concise', 'retry-language', 'generate', 'preview', 'approve'].includes(stage))
await connectDb({ autoIndex: false })
try {
  assert.equal(mongoose.connection.name, 'test')
  const runtime = await RuntimeInstance.findOne({ runtimeInstanceKey: key }).lean()
  assert.equal(runtime.packageVersion, '3.1.5')
  const actor = await User.findById('698b3800f83b3257365fd7a3')
  const permissions = await buildUserPermissionsSnapshot(actor)
  assert.ok(permissions.isActive && permissions.platformRoles.includes('SUPER_ADMIN'))
  const scopes = { ...permissions, customer: { _id: runtime.customerId }, tenant: { _id: runtime.tenantId, customerId: runtime.customerId } }
  const common = { runtimeInstanceId: key, actorUserId: String(actor._id), scopes }
  const fingerprint = hash(runtime)
  const truthHash = hash(truth(runtime))
  const evidence = runtime.framework_state.evidence_pack
  assert.equal(evidence.evidenceObjects.length, evidenceCounts[key])
  assert.equal(evidence.discoveryHealth.contradictionCandidates.length, 0)
  const accepted = Object.values(runtime.framework_state.sections).filter(s => s.accepted?.content)
  assert.equal(accepted.length, 6)
  console.log('FIXTURE_PLAN=' + JSON.stringify({ key, stage, fingerprint, truthHash, status: runtime.status, lifecycle: runtime.framework_state.lifecycle, evidence: evidence.evidenceObjects.map(e => ({ fact: e.extractedFact, reviewStatus: e.reviewStatus })), acceptedSectionCount: accepted.length, fixtureOnly: true }))
  if (stage !== 'plan') assert.equal(process.argv[3], `--confirm=${fingerprint}`, 'Fresh runtime fingerprint required')
  if (stage === 'lifecycle') {
    assert.equal(runtime.status, 'ACTIVE')
    assert.equal(runtime.framework_state.lifecycle.stage, 'DRAFT')
    for (const actionKey of ['RUN_VALIDATION', 'MARK_READY', 'SUBMIT_FOR_REVIEW', 'APPROVE', 'PUBLISH', 'LOCK_RECORD']) {
      const current = await RuntimeInstance.findById(runtime._id).lean()
      assert.equal(hash(truth(current)), truthHash)
      await executeRuntimeAction({ ...common, actionKey, payload: { expectedUpdatedAt: new Date(current.updatedAt).toISOString() } })
      const next = await RuntimeInstance.findById(runtime._id).lean()
      assert.equal(hash(truth(next)), truthHash, 'Evidence and accepted results must remain unchanged')
      console.log('FIXTURE_ACTION=' + JSON.stringify({ actionKey, status: next.status, stage: next.framework_state.lifecycle?.stage }))
    }
    const handoff = await getRuntimeStateOutcomeHandoffReadiness({ runtimeInstanceId: runtime._id, scopes })
    console.log('FIXTURE_HANDOFF=' + JSON.stringify({ status: handoff.status, blockers: handoff.handoff?.blockers, warnings: handoff.handoff?.warnings }))
  }
  const query = { runtimeInstanceId: runtime._id }
  if (stage === 'request') {
    assert.equal(runtime.status, 'LOCKED')
    assert.equal(await OutcomeSession.countDocuments(query), 0, 'Preserve existing sessions; inspect before reuse')
    const prompt = 'Create an Executive Brief for the SS-017 Test Company leadership team. Use only the accepted information. State that this is a synthetic test fixture. Retain evidence boundaries and limitations; do not invent facts, financial outcomes or named action owners.'
    await outcome.createRuntimeOutcomeSession({ ...common, payload: { prompt } })
    const session = await OutcomeSession.findOne(query).lean()
    assert.ok(session?.sessionId)
    await outcome.createRuntimeOutcomeMessage({ ...common, sessionId: session.sessionId, payload: { prompt } })
  }
  if (['clarify', 'concise'].includes(stage)) {
    assert.equal(key, 'ss016-fresh-discovery-proof')
    assert.equal(await OutcomeDraft.countDocuments(query), 0)
    const sessions = await OutcomeSession.find(query).lean()
    assert.equal(sessions.length, 1)
    const sessionId = sessions[0].sessionId
    const previousMessages = await OutcomeMessage.find({ ...query, sessionId }).lean()
    assert.equal(previousMessages.length, stage === 'concise' ? 2 : 1)
    assert.ok(previousMessages.every(message => message.role === 'USER' && message.responseStatus === 'PENDING_RESPONSE'))
    const prompt = stage === 'concise'
      ? 'Executive Brief for SS-017 Test Company leadership. Synthetic test fixture only. Use required headings verbatim and plain business language. Keep evidence limits; invent no facts, financial outcomes or owners.'
      : 'Create an Executive Brief for the SS-017 Test Company leadership team. Clearly label it as a synthetic test fixture. Use only accepted information. Use the exact required headings, including Lineage Summary, with no extra headings. Write all content in plain business language, including that final section. Retain limitations and uncertainty; do not invent facts, financial outcomes or named action owners.'
    await outcome.createRuntimeOutcomeMessage({ ...common, sessionId, payload: { prompt } })
    const messages = await OutcomeMessage.find({ ...query, sessionId, prompt, role: 'USER' }).lean()
    assert.equal(messages.length, 1)
    assert.ok(previousMessages.every(message => message.messageId !== messages[0].messageId))
    const provider = buildOutcomeStudioProviderRuntime()
    assert.equal(provider.status.configured, true, provider.status.reason)
    console.log('FIXTURE_CLARIFICATION=' + JSON.stringify({ sessionId, messageId: messages[0].messageId, oldMessageId: previousMessages[0].messageId, provider: provider.status }))
    await outcome.generateRuntimeOutcomeResponse({ ...common, ...provider.deps, sessionId, messageId: messages[0].messageId, allowReadyWithGaps: true })
    for (const previous of previousMessages) assert.deepEqual(await OutcomeMessage.findById(previous._id).lean(), previous)
  }
  if (stage === 'retry-language') {
    assert.equal(key, 'ss016-fresh-discovery-proof')
    assert.equal(await OutcomeDraft.countDocuments(query), 0)
    const sessions = await OutcomeSession.find(query).lean()
    assert.equal(sessions.length, 1)
    const sessionId = sessions[0].sessionId
    const messages = await OutcomeMessage.find({ ...query, sessionId }).lean()
    assert.equal(messages.length, 3)
    assert.ok(messages.every(message => message.role === 'USER' && message.responseStatus === 'PENDING_RESPONSE'))
    const messageId = 'out_msg_b7116f05-6af8-46ac-aea2-5a4b1b3cd34d'
    assert.equal(messages.filter(message => message.messageId === messageId).length, 1)
    const provider = buildOutcomeStudioProviderRuntime()
    assert.equal(provider.status.configured, true, provider.status.reason)
    console.log('FIXTURE_LANGUAGE_REPLAY=' + JSON.stringify({ sessionId, messageId, provider: provider.status }))
    await outcome.generateRuntimeOutcomeResponse({ ...common, ...provider.deps, sessionId, messageId, allowReadyWithGaps: true })
    for (const previous of messages.filter(message => message.messageId !== messageId)) {
      assert.deepEqual(await OutcomeMessage.findById(previous._id).lean(), previous)
    }
  }
  if (['generate', 'preview', 'approve'].includes(stage)) {
    const sessions = await OutcomeSession.find(query).lean()
    assert.equal(sessions.length, 1)
    const sessionId = sessions[0].sessionId
    if (stage === 'generate') {
      const messages = await OutcomeMessage.find({ ...query, sessionId, role: 'USER', responseStatus: 'PENDING_RESPONSE' }).lean()
      assert.equal(messages.length, 1)
      const provider = buildOutcomeStudioProviderRuntime()
      assert.equal(provider.status.configured, true, provider.status.reason)
      console.log('FIXTURE_PROVIDER=' + JSON.stringify(provider.status))
      await outcome.generateRuntimeOutcomeResponse({ ...common, ...provider.deps, sessionId, messageId: messages[0].messageId, allowReadyWithGaps: true })
    } else {
      const drafts = await OutcomeDraft.find({ ...query, sessionId }).lean()
      assert.equal(drafts.length, 1)
      const draftId = drafts[0].draftId
      if (stage === 'preview') {
        const preview = await outcome.getRuntimeOutcomeDraftPreview({ ...common, sessionId, draftId })
        console.log('FIXTURE_PREVIEW=' + JSON.stringify(preview))
      } else {
        assert.equal(key, 'ss016-fresh-discovery-proof')
        assert.equal(draftId, 'outcome_draft_3e3d38d5-fb95-431f-8e27-4843a9b85eb7')
        assert.equal(drafts[0].currentIterationId, 'outcome_draft_iteration_6d1f13cd-628e-451e-89cf-737861168e0f')
        await outcome.approveRuntimeOutcomeDraft({ ...common, sessionId, draftId })
      }
    }
  }
  assert.equal(hash(truth(await RuntimeInstance.findById(runtime._id).lean())), truthHash)
  const sessions = await OutcomeSession.find(query).select('sessionId status').lean()
  const drafts = await OutcomeDraft.find(query).select('draftId status currentIterationId approvedIterationId approvedAssetVersionId').lean()
  const versions = await OutcomeAssetVersion.find(query).select('outcomeAssetVersionId status versionNumber').lean()
  console.log('FIXTURE_RESULT=' + JSON.stringify({ stage, key, evidenceAndAcceptedResultsUnchanged: true, sessions, drafts, versions }))
} catch (error) {
  console.error('FIXTURE_ERROR=' + JSON.stringify({ code: error.code, reason: error.reason, message: error.message, details: error.details, stack: error.stack?.split('\n').slice(0, 12) }))
  process.exitCode = 1
} finally {
  await disconnectDb()
}
