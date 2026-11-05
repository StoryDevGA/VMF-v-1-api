import { createHash } from 'node:crypto'
import { G1_MODES, g1Need as need } from './masterLinkedGenuineReviewContract.js'
import { consumeMasterLinkedReviewCapability } from './masterLinkedGenuineReviewAuthorityService.js'
import { normalizeOutcomeRenderedExpressionRlProviderOutput } from './openAiOutcomeRenderedExpressionRlProviderAdapter.js'
import { normalizeMasterLinkedCategoryReviewResponse, MASTER_LINKED_CATEGORY_RESPONSE_VERSION } from './masterLinkedCategoryReviewResponseContract.js'

const endpoint = 'https://api.openai.com/v1/responses'
const nativeFetch = globalThis.fetch?.bind(globalThis)
const completed = new WeakMap(), pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const clone = value => JSON.parse(JSON.stringify(value))
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(value) ? value : ''
const responseIdValid = value => typeof value === 'string' && /^resp_[A-Za-z0-9_-]{1,195}$/.test(value)
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null
export const snapshotOwnedMasterLinkedReviewResult = result => {
  const owned = result && completed.get(result)
  need(owned && JSON.stringify(result) === owned.serialized, 'COMPLETED_MATERIAL_NOT_OWNED')
  const value = JSON.parse(owned.serialized)
  need(JSON.stringify(normalizeOutcomeRenderedExpressionRlProviderOutput(value.output)) === JSON.stringify(value.output), 'COMPLETED_OUTPUT_CHANGED')
  return { ...value, startedAt: owned.startedAt, completedAt: owned.completedAt,
    genuineProviderEligible: value.receipt.mode === G1_MODES.GENUINE, approvalAvailable: false, finalisationAvailable: false }
}
const boundedText = async (response, limit, fail) => {
  // Read incrementally. Checking text.length after response.text() would already
  // have allocated an unbounded provider response.
  need(response.body && typeof response.body.getReader === 'function', 'PROVIDER_STREAM_REQUIRED')
  const reader = response.body.getReader(), chunks = []; let bytes = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > limit) { await reader.cancel(); throw fail('PROVIDER_RESPONSE_TOO_LARGE') }
      chunks.push(Buffer.from(part.value))
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally { reader.releaseLock() }
}
const createAdapter = (mode, fetchImpl, now, sleep, category = false, approved = false) => async capability => {
  // Synchronous consumption occurs inside the owner before its first await.
  // Mode mismatch never reaches credentials or network.
  const owned = await consumeMasterLinkedReviewCapability(capability, mode, category, approved)
  const binding = clone(owned.binding), startedAt = Number(now()), deadline = startedAt + 300000
  let apiKey = '', accountFingerprint = createHash('sha256').update('UNCONFIGURED').digest('hex')
  let responseId = owned.recoveryOnly ? owned.responseId : '', submitted = false, postRequestId = owned.responseIdentity?.postRequestId || '', terminalRejection = false
  const errors = new WeakSet()
  const fail = reason => {
    const error = Object.assign(new Error('The master-linked provider review is held; no resend is permitted.'), {
      code: 'MASTER_DOCX_PROVIDER_FAILED', status: 502, details: { reason, mode, ...binding, responseId, postRequestId,
        outcome: responseId ? 'KNOWN_RESPONSE_UNRESOLVED' : terminalRejection ? 'SUBMISSION_REJECTED' : submitted ? 'SUBMISSION_UNCERTAIN' : 'NOT_SUBMITTED',
        dispatchAvailable: false, approvalAvailable: false, finalisationAvailable: false },
    })
    errors.add(error); return error
  }
  const request = async (method, url, serialized) => {
    const remaining = deadline - Number(now())
    if (remaining <= 0) throw fail('PROVIDER_TIMEOUT')
    if (method === 'POST' && (owned.recoveryOnly || Date.now() >= Date.parse(owned.expiresAt))) throw fail('POST_NOT_AUTHORISED')
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.min(60000, remaining))
    try {
      if (method === 'POST') submitted = true
      const response = await fetchImpl(url, { method, redirect: 'error', headers: { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json',
        ...(method === 'POST' ? { 'Idempotency-Key': owned.postIdempotencyKey ?? binding.requestIdentity } : {}) }, ...(serialized ? { body: serialized } : {}), signal: controller.signal })
      if (method === 'POST') postRequestId = safeId(response.headers?.get?.('x-request-id'))
      if (!response.ok) {
        if (method === 'POST') terminalRejection = [400, 401, 403, 404, 413, 422].includes(response.status)
        let reason = 'PROVIDER_HTTP_REJECTED'
        const rejected = await boundedText(response, 16384, fail)
        try { if (['context_length_exceeded', 'context_window_exceeded', 'context_overflow'].includes(JSON.parse(rejected)?.error?.code)) reason = 'PROVIDER_CONTEXT_OVERFLOW' } catch { /* Retain safe known codes only. */ }
        throw fail(reason)
      }
      const text = await boundedText(response, 512 * 1024, fail)
      if (controller.signal.aborted || Number(now()) >= deadline) throw fail('PROVIDER_TIMEOUT')
      try { return JSON.parse(text) } catch { throw fail('PROVIDER_RESPONSE_INVALID') }
    } catch (error) {
      if (errors.has(error)) throw error
      throw fail(error?.name === 'AbortError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK_FAILED')
    } finally { clearTimeout(timer) }
  }
  try {
    apiKey = mode === G1_MODES.QA ? 'SS055_FAKE_NETWORK_ONLY' : process.env.OUTCOME_STUDIO_PROVIDER_API_KEY || process.env.OPENAI_API_KEY
    if (typeof apiKey !== 'string' || !apiKey.trim() || typeof fetchImpl !== 'function') throw fail('PROVIDER_CONFIGURATION')
    accountFingerprint = createHash('sha256').update(apiKey.trim()).digest('hex')
    if (owned.recoveryOnly && (owned.responseIdentity?.accountFingerprint !== accountFingerprint
      || owned.responseIdentity?.provider !== 'OPENAI' || owned.responseIdentity?.model !== 'gpt-5.2')) throw fail('RECOVERY_ACCOUNT_CHANGED')
    let body = await request(owned.recoveryOnly ? 'GET' : 'POST', owned.recoveryOnly ? `${endpoint}/${encodeURIComponent(responseId)}` : endpoint, owned.serialized)
    if (!responseIdValid(body?.id) || responseId && body.id !== responseId) throw fail('PROVIDER_RESPONSE_ID_INVALID')
    responseId = body.id
    if (body.model !== 'gpt-5.2' && !/^gpt-5\.2-\d{4}-\d{2}-\d{2}$/.test(body.model || '')) throw fail('PROVIDER_MODEL_CHANGED')
    // Capture before awaiting durable identity storage: a fake dependency or
    // delayed callback cannot mutate the returned provider object underneath us.
    body = clone(body)
    const identity = await owned.recordResponse({ responseId, postRequestId, provider: 'OPENAI', model: 'gpt-5.2', accountFingerprint })
    if (identity?.state !== 'DURABLE_RESPONSE_ID_RECORDED' || identity.responseId !== responseId
      || Object.keys(binding).some(k => identity[k] !== binding[k])) throw fail('RESPONSE_ID_UNACKNOWLEDGED')
    while (['queued', 'in_progress'].includes(body.status)) {
      const remaining = deadline - Number(now())
      if (remaining <= 0) throw fail('PROVIDER_TIMEOUT')
      await sleep(Math.min(1000, remaining))
      const next = await request('GET', `${endpoint}/${encodeURIComponent(responseId)}`)
      if (next?.id !== responseId) throw fail('PROVIDER_RESPONSE_ID_CHANGED')
      if (next.model !== body.model) throw fail('PROVIDER_MODEL_CHANGED')
      body = clone(next)
    }
    if (body.status !== 'completed' || !Array.isArray(body.output)) throw fail('PROVIDER_TERMINAL_FAILURE')
    const outputs = []
    for (const item of body.output) if (item?.type === 'message' && Array.isArray(item.content)) for (const part of item.content) {
      if (part?.type === 'refusal') throw fail('PROVIDER_REFUSED')
      if (part?.type === 'output_text' && typeof part.text === 'string') outputs.push(part.text)
    }
    if (outputs.length !== 1 || Buffer.byteLength(outputs[0]) > 60000) throw fail('PROVIDER_OUTPUT_INVALID')
    let output
    try { output = category ? normalizeMasterLinkedCategoryReviewResponse(outputs[0])
      : normalizeOutcomeRenderedExpressionRlProviderOutput(JSON.parse(outputs[0])) } catch { throw fail('PROVIDER_OUTPUT_INVALID') }
    const completedAt = Number(now())
    if (completedAt >= deadline) throw fail('PROVIDER_TIMEOUT')
    const result = { output, receipt: { version: approved === 'NARROW' ? 'master-linked-docx-visual-review-receipt.v5' : approved ? 'master-linked-docx-visual-review-receipt.v4' : category ? 'master-linked-docx-visual-review-receipt.v3' : 'master-linked-docx-visual-review-receipt.v2',
      ...(category ? { requestVersion: approved === 'NARROW' ? 'master-linked-docx-visual-review-request.v5' : approved ? 'master-linked-docx-visual-review-request.v4' : 'master-linked-docx-visual-review-request.v3', responseVersion: MASTER_LINKED_CATEGORY_RESPONSE_VERSION } : {}),
      mode, ...binding, responseId, postRequestId,
      grant: owned.grant || null, reservation: owned.reservation || null, start: owned.start || null,
      provider: clone(owned.subject.transport), returnedModel: body.model, terminalStatus: 'completed', latencyMs: Math.max(0, completedAt - startedAt),
      pages: clone(owned.pageReceipts), inputFingerprint: owned.inputFingerprint, docxChecksum: owned.docxChecksum,
      tokenUsage: { inputTokens: count(body.usage?.input_tokens), outputTokens: count(body.usage?.output_tokens), totalTokens: count(body.usage?.total_tokens) },
      storeRequested: false, temporaryProviderStorageForPolling: true }, completionPersisted: false, approvalAvailable: false, finalisationAvailable: false }
    completed.set(result, { serialized: JSON.stringify(result), startedAt: new Date(startedAt).toISOString(), completedAt: new Date(completedAt).toISOString() })
    return result
  } catch (error) {
    try { await owned.recordUncertainty({ responseId, postRequestId, provider: 'OPENAI', model: 'gpt-5.2', accountFingerprint,
      reason: errors.has(error) ? 'PROVIDER_FAILED' : 'RECEIPT_FAILED', state: 'HELD_NO_RETRY' }) }
    catch { throw fail('UNCERTAINTY_UNCONFIRMED') }
    if (errors.has(error)) throw error
    throw fail('REQUIRED_RECEIPT_FAILED')
  }
}

export const createOpenAiMasterLinkedDocxReviewProviderAdapter = (...args) => {
  need(args.length === 0, 'LIVE_ADAPTER_OVERRIDES_FORBIDDEN')
  return createAdapter(G1_MODES.GENUINE, nativeFetch, Date.now, pause)
}
export const createOpenAiMasterLinkedCategoryDocxReviewProviderAdapter = (...args) => {
  need(args.length === 0, 'LIVE_ADAPTER_OVERRIDES_FORBIDDEN')
  return createAdapter(G1_MODES.GENUINE, nativeFetch, Date.now, pause, true)
}
export const createOpenAiApprovedMasterLinkedDocxReviewProviderAdapter = (...args) => {
  need(args.length === 0, 'LIVE_ADAPTER_OVERRIDES_FORBIDDEN')
  return createAdapter(G1_MODES.GENUINE, nativeFetch, Date.now, pause, true, true)
}
export const createOpenAiNarrowMasterLinkedDocxReviewProviderAdapter = (...args) => {
  need(args.length === 0, 'LIVE_ADAPTER_OVERRIDES_FORBIDDEN')
  return createAdapter(G1_MODES.GENUINE, nativeFetch, Date.now, pause, true, 'NARROW')
}
export const createFakeNetworkMasterLinkedDocxReviewProviderAdapter = ({ fetchImpl, now = Date.now, sleep = pause } = {}) => {
  need([fetchImpl, now, sleep].every(f => typeof f === 'function'), 'FAKE_TRANSPORT_REQUIRED')
  return createAdapter(G1_MODES.QA, fetchImpl, now, sleep)
}
export const createFakeNetworkMasterLinkedCategoryReviewProviderAdapter = ({ fetchImpl, now = Date.now, sleep = pause } = {}) => {
  need([fetchImpl, now, sleep].every(f => typeof f === 'function'), 'FAKE_TRANSPORT_REQUIRED')
  return createAdapter(G1_MODES.QA, fetchImpl, now, sleep, true)
}
export const createFakeNetworkApprovedMasterLinkedDocxReviewProviderAdapter = options => {
  need(options && Object.getPrototypeOf(options) === Object.prototype && Reflect.ownKeys(options).length === 1, 'FAKE_TRANSPORT_REQUIRED')
  const fetch = Object.getOwnPropertyDescriptor(options, 'fetchImpl')
  need(fetch?.enumerable === true && Object.hasOwn(fetch, 'value') && typeof fetch.value === 'function', 'FAKE_TRANSPORT_REQUIRED')
  return createAdapter(G1_MODES.QA, fetch.value, Date.now, pause, true, true)
}
