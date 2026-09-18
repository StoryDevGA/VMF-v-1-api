import { createHmac, randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import env from '../config/env.js'
import encryption from './fieldEncryptionService.js'
import { OutcomeSession } from '../models/index.js'
import { assertRuntimePermission, getRuntimeInstance } from './runtimeInstanceService.js'
import { getRuntimeOutcomePlanningEvidence, RUNTIME_STATE_V2_CONTROL_PROJECTION } from './runtimeStateRepository.js'
import { resolveOutcomeStudioKnowledgePackBinding } from './outcomeKnowledgePackRegistryService.js'
import { projectOutcomeStudioDeliverableDiscovery } from './outcomeStudioKnowledgeContextService.js'
import { resolveOutcomeStudioConversationOutputContract } from './outcomeStudioOutputContractResolutionService.js'
import { buildOutcomeKnowledgeCompositionPlanForRuntime, createOutcomeKnowledgeCompositionPlan,
  getOutcomeRequestKnowledgeCompositionPlan } from './outcomeKnowledgeCompositionPlanService.js'

const PURPOSE = 'outcome-studio.request-planning'
const VERSION = 1
const TTL_MS = 30 * 60 * 1000
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const text = (value) => String(value ?? '').trim()
const id = (value) => String(value?._id || value?.id || value || '')
const failure = (code, status = 409) => Object.assign(new Error('Outcome planning could not complete this step.'), { code, status, details: { reason: code } })
const questions = Object.freeze({
  outcome: 'What outcome should this output achieve?',
  decisionPurpose: 'What decision should this output support?',
  consumer: 'Who will use this output?',
  audience: 'Who is the audience? Separate multiple audiences with a semicolon.',
  format: 'What output format do you want?',
  channel: 'What is the delivery channel? Reply skip if unspecified.',
  requirements: 'What additional requirements apply? Separate them with a semicolon, or reply skip.',
})
const execution = Object.freeze({ status: 'BLOCKED', canExecute: false, reason: 'REQUEST_EXECUTION_NOT_ENABLED' })
const readyExecution = Object.freeze({ status: 'READY', canExecute: true, reason: 'CLARIFICATION_CONFIRMED' })
const basis = Object.freeze({ PROMPT: 'PROMPT', PROMPT_AND_METADATA: 'PROMPT_AND_ACTIVE_KNOWLEDGE_PACK_METADATA',
  OUTPUT_TYPE_DEFAULT: 'OUTPUT_TYPE_DEFAULT', OPTIONAL_UNSPECIFIED: 'OPTIONAL_UNSPECIFIED' })
const now = (deps) => (deps.now || Date.now)()
const key = (deps) => {
  const secret = deps.receiptSecret || env.jwtSecret
  if (typeof secret !== 'string' || secret.length < 32) throw failure('OUTCOME_PLANNING_RECEIPT_UNAVAILABLE', 503)
  return createHmac('sha256', secret).update(`${PURPOSE}:encryption:v${VERSION}`).digest('hex')
}
const seal = (state, deps) => {
  const issuedAt = now(deps)
  return encryption.encrypt(JSON.stringify({ ...state, purpose: PURPOSE, version: VERSION,
    issuedAt, expiresAt: issuedAt + TTL_MS }), key(deps))
}
const open = (receipt, deps) => {
  try {
    if (typeof receipt !== 'string' || receipt.length > 32768 || !encryption.isEncrypted(receipt)) throw new Error('shape')
    const state = JSON.parse(encryption.decrypt(receipt, key(deps)))
    if (state.purpose !== PURPOSE || state.version !== VERSION || !UUID.test(state.requestId)
      || !Number.isSafeInteger(state.expiresAt) || !Number.isSafeInteger(state.issuedAt)
      || state.issuedAt > now(deps) || state.expiresAt <= now(deps) || state.expiresAt - state.issuedAt !== TTL_MS) throw new Error('claims')
    return state
  } catch { throw failure('OUTCOME_PLANNING_RECEIPT_INVALID', 403) }
}
const controlReader = ({ runtimeInstanceId, scopes }) => getRuntimeInstance({ runtimeInstanceId, scopes,
  projection: RUNTIME_STATE_V2_CONTROL_PROJECTION, maxTimeMS: 2000 })
const scopedDeps = (deps) => ({ ...deps, readRuntimeControl: deps.readRuntimeControl || controlReader,
  readKcpRuntimeEvidence: deps.readKcpRuntimeEvidence || getRuntimeOutcomePlanningEvidence })
const authorize = async ({ actorUserId, runtimeInstanceId, scopes, sessionId = '', state, deps, write = true }) => {
  if (!mongoose.isValidObjectId(actorUserId)) throw failure('OUTCOME_PLANNING_UNAUTHORIZED', 401)
  const runtime = await (deps.readRuntimeControl || controlReader)({ runtimeInstanceId, scopes })
  const scope = { runtimeInstanceId: id(runtime), tenantId: id(runtime.tenantId), customerId: id(runtime.customerId) }
  await (deps.assertRuntimePermission || assertRuntimePermission)({ actorUserId, scopes, ...scope,
    permission: `${runtime.runtimeType === 'DEAL_ANALYSIS' ? 'DEAL' : 'VMF'}_${write ? 'UPDATE' : 'VIEW'}` })
  if (state && (state.actorUserId !== id(actorUserId)
    || Object.keys(scope).some((field) => state.scope?.[field] !== scope[field]))) throw failure('OUTCOME_PLANNING_SCOPE_MISMATCH', 403)
  const associatedSession = state?.sessionId || sessionId
  if (state && sessionId && state.sessionId !== sessionId) throw failure('OUTCOME_PLANNING_SESSION_MISMATCH', 403)
  if (associatedSession) {
    const model = deps.OutcomeSession || OutcomeSession
    const session = await model.findOne({ ...scope, sessionId: associatedSession }).lean()
    if (!session) throw failure('OUTCOME_PLANNING_SESSION_MISMATCH', 404)
  }
  return { runtime, scope, sessionId: associatedSession }
}
const intentProjection = (intent = {}) => Object.fromEntries(
  ['originalRequest', 'outcome', 'decisionPurpose', 'consumer', 'audience', 'requestedOutputTypeKey', 'outputTypeLabel',
    'evidenceSource', 'constraints', 'format', 'channel', 'requirements', 'resolutionBasis', 'missingRequiredFields',
    'clarificationQuestions', 'answeredClarificationQuestions', 'selectedSchema', 'selectedKnowledgePacks', 'runtimeIntegrity']
    .filter((field) => intent[field] !== undefined).map((field) => [field, intent[field]]))
const respond = (state, deps, extra = {}) => ({
  status: state.phase, requestId: state.requestId, continuation: seal(state, deps),
  question: state.field ? questions[state.field] || 'Which output type do you want? Use its name.' : '',
  intent: intentProjection(state.intent), execution: state.execution || execution, ...extra,
})
const receiptProjection = (plan = {}) => {
  const receipt = plan.payload?.clarificationReceipt
  if (!receipt || receipt.stageKey !== 'CLARIFICATION' || receipt.status !== 'PASSED') return null
  return { ...receipt, confirmedBy: id(plan.createdBy), executedAt: plan.createdAt || '' }
}
const planProjection = (result) => ({
  planId: result.plan.planId, requestId: result.plan.requestId, planVersion: result.plan.planVersion,
  status: result.plan.status, outputTypeKey: result.plan.requestedOutputTypeKey,
  intent: intentProjection(result.plan.payload.consumerIntent),
  clarificationReceipt: receiptProjection(result.plan),
  outputContract: {
    outputType: result.plan.payload.governedContext?.outputType || null,
    outputSchema: result.plan.payload.governedContext?.outputSchema || null,
    style: result.plan.payload.governedContext?.style || null,
    selectedPacks: result.plan.payload.resolution?.selectedPacks || [],
  },
  runtimeIntegrity: result.plan.payload.planningEvidence || null,
  currentness: { current: false, evidenceStatus: 'NOT_REVALIDATED', latestInRequest: result.currentness.latestInRequest === true },
  execution: receiptProjection(result.plan) ? readyExecution : execution, idempotent: result.idempotent === true,
})

const firstSentence = (value) => text(value).split(/(?<=[.!?])\s+/)[0]?.replace(/[.!?]+$/, '') || ''
const matchGroup = (value, expression) => text(expression.exec(value)?.[1]).replace(/[.!?]+$/, '')
const inferAudience = (prompt, resolution) => {
  const explicit = matchGroup(prompt, /\bfor\s+(.+?)(?=\s+(?:using|to|with|focus(?:ing)?\s+on|preserv(?:e|ing))\b|[.!?]|$)/i)
  if (explicit) return { value: [explicit.replace(/^(?:the|a|an)\s+/i, '')], source: basis.PROMPT }
  const label = text(resolution?.audience?.label)
  return label ? { value: [label], source: basis.PROMPT_AND_METADATA } : { value: [], source: '' }
}
const inferDecisionPurpose = (prompt, resolution) => {
  const focused = matchGroup(prompt, /\bfocus(?:ing)?\s+on\s+(.+?)(?=\.\s*(?:preserv(?:e|ing)|ensure|keep)\b|$)/i)
  if (focused) return { value: focused, source: basis.PROMPT }
  const explicit = matchGroup(prompt, /\bto\s+(.+?)(?=[.!?]|$)/i)
  if (explicit) return { value: explicit, source: basis.PROMPT }
  const label = text(resolution?.purpose?.label)
  return label ? { value: label, source: basis.PROMPT_AND_METADATA } : { value: '', source: '' }
}
const inferEvidenceSource = (prompt) => {
  const value = matchGroup(prompt, /\busing\s+(.+?)(?=\.\s*(?:focus(?:ing)?\s+on|preserv(?:e|ing))\b|[.!?]|$)/i)
  return value ? { value, source: basis.PROMPT } : { value: 'current governed runtime handoff', source: basis.OUTPUT_TYPE_DEFAULT }
}
const inferConstraints = (prompt) => [
  /evidence boundaries/i.test(prompt) ? 'Preserve evidence boundaries' : '',
  /claim restrictions/i.test(prompt) ? 'Preserve claim restrictions' : '',
  /governance gates/i.test(prompt) ? 'Preserve governance gates' : '',
].filter(Boolean)

export const inferOutcomeStudioRequestIntent = ({ prompt, resolution, deliverables = [] } = {}) => {
  const originalRequest = text(prompt)
  const outputTypeKey = text(resolution?.selectedOutputType?.key).toLowerCase()
  const outputType = deliverables.find((entry) => text(entry.key).toLowerCase() === outputTypeKey)
  const outputTypeLabel = text(outputType?.label || resolution?.selectedOutputType?.label)
  const audience = inferAudience(originalRequest, resolution)
  const purpose = inferDecisionPurpose(originalRequest, resolution)
  const evidence = inferEvidenceSource(originalRequest)
  const constraints = inferConstraints(originalRequest)
  const outcome = firstSentence(originalRequest)
  const format = outputTypeKey ? 'document' : ''
  const intent = {
    originalRequest,
    outcome,
    decisionPurpose: purpose.value,
    consumer: audience.value[0] || '',
    audience: audience.value,
    requestedOutputTypeKey: outputTypeKey,
    outputTypeLabel,
    evidenceSource: evidence.value,
    constraints,
    format,
    channel: '',
    requirements: constraints,
    unresolvedGaps: [],
    resolutionBasis: {
      requestedOutputTypeKey: basis.PROMPT_AND_METADATA,
      audience: audience.source,
      decisionPurpose: purpose.source,
      evidenceSource: evidence.source,
      constraints: constraints.length ? basis.PROMPT : basis.OPTIONAL_UNSPECIFIED,
      format: format ? basis.OUTPUT_TYPE_DEFAULT : '',
      channel: basis.OPTIONAL_UNSPECIFIED,
    },
  }
  intent.missingRequiredFields = [
    ['outcome', intent.outcome], ['decisionPurpose', intent.decisionPurpose],
    ['audience', intent.audience.length], ['requestedOutputTypeKey', intent.requestedOutputTypeKey], ['format', intent.format],
  ].filter(([, value]) => !value).map(([field]) => field)
  intent.clarificationQuestions = intent.missingRequiredFields.map((field) => questions[field] || 'Which output type do you want? Use its name.')
  intent.answeredClarificationQuestions = []
  return intent
}

export const planOutcomeStudioRequest = async ({ actorUserId, runtimeInstanceId, scopes, payload = {}, deps = {} } = {}) => {
  const previous = payload.continuation ? open(payload.continuation, deps) : null
  const auth = await authorize({ actorUserId, runtimeInstanceId, scopes, sessionId: payload.sessionId, state: previous, deps })
  const prompt = text(payload.prompt)
  if (!prompt || prompt.length > 2000) throw failure('OUTCOME_PLANNING_ANSWER_REQUIRED', 422)
  let state = previous || { actorUserId: id(actorUserId), scope: auth.scope, sessionId: auth.sessionId,
    requestId: randomUUID(), intent: {}, operation: 'INITIAL', expectedCurrentPlanVersion: 0, phase: 'CLARIFICATION_REQUIRED', field: 'requestedOutputTypeKey' }
  if (payload.action === 'RE_RESOLVE') {
    if (!previous || !['CONFIRMATION_REQUIRED', 'SAVED'].includes(previous.phase)) {
      throw failure('OUTCOME_PLANNING_PREDECESSOR_REQUIRED')
    }
    if (previous.phase === 'CONFIRMATION_REQUIRED') {
      state = { ...previous, phase: 'CLARIFICATION_REQUIRED', field: 'requestedOutputTypeKey', intent: {} }
    } else {
      state = { ...previous, phase: 'CLARIFICATION_REQUIRED', field: 'requestedOutputTypeKey', intent: {},
        operation: 'RE_RESOLUTION', expectedCurrentPlanVersion: previous.planVersion,
        sourcePlanId: previous.planId, sourcePlanFingerprint: previous.planFingerprint, reResolutionReason: prompt }
      return respond(state, deps)
    }
  }
  if (state.phase === 'SAVED') throw failure('OUTCOME_PLANNING_EXPLICIT_RERESOLUTION_REQUIRED')
  if (state.field === 'requestedOutputTypeKey') {
    const { binding } = await (deps.resolveBinding || resolveOutcomeStudioKnowledgePackBinding)({ query: { ...auth.runtime, runtimeInstanceId: auth.scope.runtimeInstanceId, workspaceType: 'OUTCOME' } })
    const discovery = projectOutcomeStudioDeliverableDiscovery(binding)
    if (!discovery.available?.length) return respond({ ...state, phase: 'BLOCKED' }, deps, {
      question: '', blockers: ['NO_ELIGIBLE_OUTPUT_CONTRACT'],
      message: 'No active compatible output contract is available. An administrator must resolve the configuration before planning can continue.',
    })
    const resolution = resolveOutcomeStudioConversationOutputContract({ prompt, deliverables: discovery.available })
    if (resolution.status !== 'RESOLVED') return respond(state, deps)
    state.intent = inferOutcomeStudioRequestIntent({ prompt, resolution, deliverables: discovery.available })
  } else if (state.field) {
    state.intent.answeredClarificationQuestions = [...new Set([
      ...(state.intent.answeredClarificationQuestions || []),
      questions[state.field] || 'Which output type do you want? Use its name.',
    ])]
    const optional = ['channel', 'requirements'].includes(state.field)
    const answer = optional && prompt.toLowerCase() === 'skip' ? '' : prompt
    state.intent[state.field] = ['audience', 'requirements'].includes(state.field)
      ? [...new Set(answer.split(';').map(text).filter(Boolean))] : answer
    if (state.field === 'audience' && !state.intent.audience.length) throw failure('OUTCOME_PLANNING_ANSWER_REQUIRED', 422)
    if (state.field === 'audience' && !state.intent.consumer) state.intent.consumer = state.intent.audience[0]
    state.intent.resolutionBasis = { ...(state.intent.resolutionBasis || {}), [state.field]: basis.PROMPT }
  }
  state.intent.missingRequiredFields = Object.keys(questions)
    .filter((field) => !['consumer', 'channel', 'requirements'].includes(field))
    .filter((field) => Array.isArray(state.intent[field]) ? !state.intent[field].length : !text(state.intent[field]))
  state.intent.clarificationQuestions = state.intent.missingRequiredFields
    .map((field) => questions[field] || 'Which output type do you want? Use its name.')
  state.field = state.intent.missingRequiredFields[0]
    || Object.keys(questions).find((field) => state.intent[field] === undefined) || ''
  if (state.field) return respond({ ...state, phase: 'CLARIFICATION_REQUIRED' }, deps)
  state.intent.unresolvedGaps = []
  const evidence = await (deps.readKcpRuntimeEvidence || getRuntimeOutcomePlanningEvidence)({ runtimeInstanceId, scopes })
  state.intent.runtimeIntegrity = evidence.planningEvidence || null
  const requestScope = { ...auth.scope, requestId: state.requestId }
  const requestAssociation = { sessionId: state.sessionId || '' }
  const candidate = await (deps.buildKcpCandidate || buildOutcomeKnowledgeCompositionPlanForRuntime)({ actorUserId, scopes,
    runtimeInstanceId: auth.scope.runtimeInstanceId, requestScope, requestAssociation,
    consumerIntent: state.intent, expectedRuntimeUpdatedAt: evidence.updatedAt, deps: scopedDeps(deps) })
  if (candidate.status === 'BLOCKED') return respond({ ...state, phase: 'BLOCKED' }, deps, { blockers: ['KNOWLEDGE_COMPOSITION_BLOCKED'] })
  state.intent.selectedSchema = candidate.payload?.governedContext?.outputSchema || null
  state.intent.selectedKnowledgePacks = (candidate.payload?.resolution?.selectedPacks || []).map((pack) => ({
    packKey: pack.packKey,
    label: pack.label,
    versionId: pack.versionId,
    knowledgeLayer: pack.knowledgeLayer,
  }))
  state = { ...state, phase: 'CONFIRMATION_REQUIRED', expectedPlanFingerprint: candidate.planFingerprint,
    expectedRuntimeUpdatedAt: new Date(evidence.updatedAt).toISOString() }
  return respond(state, deps, { planStatus: candidate.status, message: 'Confirm these inferred facts to save the governed request plan.' })
}

export const confirmOutcomeStudioRequestPlan = async ({ actorUserId, runtimeInstanceId, scopes, requestId, payload = {}, deps = {} } = {}) => {
  const state = open(payload.continuation, deps)
  if (state.phase !== 'CONFIRMATION_REQUIRED' || state.requestId !== requestId || payload.confirm !== true) throw failure('OUTCOME_PLANNING_CONFIRMATION_REQUIRED', 422)
  const auth = await authorize({ actorUserId, runtimeInstanceId, scopes, state, deps })
  const result = await createOutcomeKnowledgeCompositionPlan({ actorUserId, scopes, runtimeInstanceId: auth.scope.runtimeInstanceId,
    requestScope: { ...auth.scope, requestId }, requestAssociation: { sessionId: state.sessionId || '' },
    consumerIntent: state.intent, expectedRuntimeUpdatedAt: state.expectedRuntimeUpdatedAt, expectedPlanFingerprint: state.expectedPlanFingerprint,
    operation: state.operation, expectedCurrentPlanVersion: state.expectedCurrentPlanVersion,
    sourcePlanId: state.sourcePlanId || '', sourcePlanFingerprint: state.sourcePlanFingerprint || '', reResolutionReason: state.reResolutionReason || '', deps: scopedDeps(deps) })
  const projectedPlan = planProjection(result)
  return respond({ ...state, phase: 'SAVED', planId: result.plan.planId, planVersion: result.plan.planVersion,
    planFingerprint: result.plan.planFingerprint, execution: projectedPlan.execution }, deps, { plan: projectedPlan })
}

export const retrieveOutcomeStudioRequestPlan = async ({ actorUserId, runtimeInstanceId, scopes, requestId, planId, deps = {} } = {}) => {
  if (!UUID.test(requestId) || !/^outcome_kcp_[a-f0-9-]{36}$/.test(planId)) throw failure('OUTCOME_PLANNING_IDENTITY_INVALID', 422)
  const auth = await authorize({ actorUserId, runtimeInstanceId, scopes, deps, write: false })
  const result = await getOutcomeRequestKnowledgeCompositionPlan({ actorUserId, scopes, runtimeInstanceId: auth.scope.runtimeInstanceId,
    requestScope: { ...auth.scope, requestId }, planId, deps: scopedDeps(deps) })
  const sessionId = result.plan.payload.requestAssociation?.sessionId || ''
  await authorize({ actorUserId, runtimeInstanceId, scopes, sessionId, deps, write: false })
  const projectedPlan = planProjection(result)
  return respond({ actorUserId: id(actorUserId), scope: auth.scope, sessionId, requestId,
    intent: result.plan.payload.consumerIntent, phase: 'SAVED', field: '', planId, planVersion: result.plan.planVersion,
    planFingerprint: result.plan.planFingerprint, execution: projectedPlan.execution }, deps, { plan: projectedPlan })
}
