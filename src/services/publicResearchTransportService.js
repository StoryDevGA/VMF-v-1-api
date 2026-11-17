import { createHash } from 'node:crypto'
import { z } from 'zod'
import { prepareTavilyFixtureRequest, prepareTavilySearchRequest, prepareCompaniesHouseProfileRequest } from './publicResearchResponseContract.js'

const witnessSchema = z.object({ operation: z.enum(['TAVILY_SEARCH', 'COMPANIES_HOUSE_PROFILE']),
  approvalRef: z.string().trim().min(1).max(180), releaseRef: z.string().trim().min(1).max(180),
  credentialOwner: z.string().trim().min(1).max(180), spendOwner: z.string().trim().min(1).max(180),
  expiresAt: z.string().datetime() }).strict()
const limitsSchema = z.object({ maxResponseBytes: z.number().int().min(1).max(16384),
  timeoutMs: z.number().int().min(1).max(60000) }).strict()
const fail = (reason, transportReceipt) => { throw Object.assign(new Error('Public research transport is unavailable.'), {
  status: 409, code: 'CONFLICT', details: { reason },
  ...(transportReceipt ? { transportReceipt } : {}),
}) }
const offlineLimits = Object.freeze({ maxResponseBytes: 16384, timeoutMs: 1000 })
const hash = text => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`

// The authenticated caller owns approval verification. This transport validates
// its explicit server-side dependencies; a witness is not a release or grant.
const dispatch = async (operation, descriptor, options) => {
  const { mode, send, credential, authorization } = options || {}
  let limits, headers = { 'Content-Type': 'application/json' }, protectedText = []
  if (typeof send !== 'function' || !['OFFLINE', 'LIVE'].includes(mode)) fail('PUBLIC_RESEARCH_TRANSPORT_NOT_CONFIGURED')
  if (mode === 'OFFLINE') {
    if (credential !== undefined || authorization !== undefined)
      fail('PUBLIC_RESEARCH_OFFLINE_CREDENTIALS_FORBIDDEN')
    const budget = limitsSchema.safeParse(options.limits || offlineLimits)
    if (!budget.success || budget.data.timeoutMs > offlineLimits.timeoutMs) fail('PUBLIC_RESEARCH_LIMITS_INVALID')
    limits = budget.data
  } else {
    const witness = witnessSchema.safeParse(authorization), budget = limitsSchema.safeParse(options.limits)
    if (!witness.success || witness.data.operation !== operation || Date.parse(witness.data.expiresAt) <= Date.now()
      || !budget.success) fail('PUBLIC_RESEARCH_AUTHORIZATION_REQUIRED')
    if (typeof credential !== 'string' || !/^[\x21-\x7E]{1,512}$/.test(credential)
      || operation === 'COMPANIES_HOUSE_PROFILE' && credential.includes(':')) fail('PUBLIC_RESEARCH_CREDENTIAL_UNAVAILABLE')
    const token = operation === 'TAVILY_SEARCH' ? credential : Buffer.from(credential + ':', 'utf8').toString('base64')
    headers = { ...headers, Authorization: (operation === 'TAVILY_SEARCH' ? 'Bearer ' : 'Basic ') + token }
    protectedText = [credential, token, headers.Authorization, JSON.stringify(credential).slice(1, -1)]
    limits = budget.data
  }
  const controller = new AbortController(), started = Date.now()
  let timer, reader, timedOut = false, oversized = false, secretEcho = false, responseText = '', bytesRead = 0, observedHttpStatus = null
  const rejectEcho = () => {
    if (protectedText.some(value => responseText.includes(value))) {
      secretEcho = true; fail('PUBLIC_RESEARCH_CREDENTIAL_ECHO')
    }
  }
  const result = (transportOutcome, httpStatus) => {
    rejectEcho()
    return { classification: mode === 'OFFLINE' ? 'OFFLINE_SYNTHETIC_HTTP_RESPONSE' : 'PROVIDER_HTTP_RESPONSE',
      operation, transportOutcome, httpStatus, observedHttpStatus, responseText, responseTextHash: hash(responseText),
      bytesRead, elapsedMs: Math.max(0, Date.now() - started), requestDescriptor: descriptor,
      limits: { ...limits, retries: 0, redirects: 0 } }
  }
  const failureReceipt = (transportOutcome, redact = false) => ({ httpStatus: observedHttpStatus,
    responseText: redact ? null : responseText, responseTextHash: redact ? null : hash(responseText),
    bytesRead, elapsedMs: Math.max(0, Date.now() - started), transportOutcome, bodyComplete: false })
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('Deadline.')) }, limits.timeoutMs)
  })
  try {
    const response = await Promise.race([Promise.resolve().then(() => send(descriptor.url, {
      method: descriptor.method, headers, ...(descriptor.body ? { body: JSON.stringify(descriptor.body) } : {}),
      redirect: 'error', signal: controller.signal,
    })), timeout])
    if (!Number.isInteger(response?.status) || response.status < 100 || response.status > 599 || response.redirected === true)
      fail('PUBLIC_RESEARCH_TRANSPORT_INVALID')
    observedHttpStatus = response.status
    if (!response.body && [204, 304].includes(response.status)) return result('COMPLETE', response.status)
    if (typeof response.body?.getReader !== 'function') fail('PUBLIC_RESEARCH_TRANSPORT_INVALID')
    reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8', { fatal: true })
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout])
      if (done) break
      if (!(value instanceof Uint8Array)) fail('PUBLIC_RESEARCH_TRANSPORT_INVALID')
      bytesRead += value.byteLength
      if (bytesRead > limits.maxResponseBytes) { oversized = true; fail('PUBLIC_RESEARCH_RESPONSE_TOO_LARGE') }
      responseText += decoder.decode(value, { stream: true })
      rejectEcho()
    }
    responseText += decoder.decode()
    return result('COMPLETE', response.status)
  } catch {
    if (secretEcho) fail('PUBLIC_RESEARCH_CREDENTIAL_ECHO', failureReceipt('FAILED', true))
    if (timedOut) return result('TIMEOUT', null)
    if (oversized) fail('PUBLIC_RESEARCH_RESPONSE_TOO_LARGE', failureReceipt('LIMIT_EXCEEDED'))
    fail('PUBLIC_RESEARCH_TRANSPORT_INVALID', failureReceipt('FAILED'))
  } finally {
    clearTimeout(timer); controller.abort()
    try { Promise.resolve(reader?.cancel()).catch(() => {}) } catch { /* Never reflect dependency errors. */ }
  }
}

export const executeTavilySearchTransport = async (args, options) => {
  const { descriptor } = args?.provider === 'TAVILY_SEARCH' ? prepareTavilyFixtureRequest(args) : prepareTavilySearchRequest(args)
  return dispatch('TAVILY_SEARCH', { method: descriptor.method, url: descriptor.url, body: descriptor.body }, options)
}
export const executeCompaniesHouseProfileTransport = async (args, options) => {
  const { descriptor } = prepareCompaniesHouseProfileRequest(args)
  return dispatch('COMPANIES_HOUSE_PROFILE', { method: descriptor.method, url: descriptor.url }, options)
}
