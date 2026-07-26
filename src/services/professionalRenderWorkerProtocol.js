import { createHash, randomUUID } from 'node:crypto'
import { createRequire, syncBuiltinESMExports } from 'node:module'

const moduleRequire = createRequire(import.meta.url)

export const PROFESSIONAL_RENDER_WORKER_PROTOCOL_VERSION = 'oes-004-render-worker.v1'
export const PROFESSIONAL_RENDER_WORKER_JOB_TYPE = 'RENDER_INFOGRAPHIC_SVG_CANDIDATE'

export const PROFESSIONAL_RENDER_WORKER_LIMITS = Object.freeze({
  payloadBytes: 262144,
  requestBytes: 270000,
  decodedOutputBytes: 65536,
  metadataBytes: 4096,
  responseBytes: 100000,
  operationTimeoutMs: 5000,
  terminationGraceMs: 500,
  terminationConfirmationMs: 2000,
})

export const PROFESSIONAL_RENDER_WORKER_ERROR_CODES = Object.freeze({
  INPUT_INVALID: 'PROFESSIONAL_RENDER_WORKER_INPUT_INVALID',
  SPAWN_FAILED: 'PROFESSIONAL_RENDER_WORKER_SPAWN_FAILED',
  SEND_FAILED: 'PROFESSIONAL_RENDER_WORKER_SEND_FAILED',
  TIMEOUT: 'PROFESSIONAL_RENDER_WORKER_TIMEOUT',
  EXITED: 'PROFESSIONAL_RENDER_WORKER_EXITED',
  RESPONSE_INVALID: 'PROFESSIONAL_RENDER_WORKER_RESPONSE_INVALID',
  OUTPUT_LIMIT: 'PROFESSIONAL_RENDER_WORKER_OUTPUT_LIMIT',
  RENDER_FAILED: 'PROFESSIONAL_RENDER_WORKER_RENDER_FAILED',
  CLEANUP_FAILED: 'PROFESSIONAL_RENDER_WORKER_CLEANUP_FAILED',
})

export const PROFESSIONAL_RENDER_WORKER_ERROR_REASONS = Object.freeze({
  INPUT_INVALID: 'WORKER_INPUT_INVALID',
  SPAWN_FAILED: 'WORKER_SPAWN_FAILED',
  SEND_FAILED: 'WORKER_SEND_FAILED',
  TIMEOUT: 'WORKER_TIMEOUT',
  EXITED: 'WORKER_EXITED_BEFORE_SUCCESS',
  RESPONSE_INVALID: 'WORKER_RESPONSE_INVALID',
  OUTPUT_LIMIT: 'WORKER_OUTPUT_LIMIT_EXCEEDED',
  RENDER_FAILED: 'WORKER_RENDER_FAILED',
  CLEANUP_FAILED: 'WORKER_CLEANUP_FAILED',
})

const ERROR_MESSAGE = 'Professional render worker request failed.'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

export class ProfessionalRenderWorkerError extends Error {
  constructor({ code, reason, stage }) {
    super(ERROR_MESSAGE)
    this.name = 'ProfessionalRenderWorkerError'
    this.code = code
    this.reason = reason
    this.details = Object.freeze({
      stage,
      contentIncludedInError: false,
    })
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      reason: this.reason,
      message: this.message,
      details: this.details,
    }
  }
}

export const createProfessionalRenderWorkerError = ({
  code = PROFESSIONAL_RENDER_WORKER_ERROR_CODES.RESPONSE_INVALID,
  reason = PROFESSIONAL_RENDER_WORKER_ERROR_REASONS.RESPONSE_INVALID,
  stage = 'response',
} = {}) => new ProfessionalRenderWorkerError({ code, reason, stage })

const failInput = (stage = 'input') => {
  throw createProfessionalRenderWorkerError({
    code: PROFESSIONAL_RENDER_WORKER_ERROR_CODES.INPUT_INVALID,
    reason: PROFESSIONAL_RENDER_WORKER_ERROR_REASONS.INPUT_INVALID,
    stage,
  })
}

const failResponse = (stage) => {
  throw createProfessionalRenderWorkerError({ stage })
}

const assertExactKeys = (value, keys, stage, fail = failInput) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(stage)
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(stage)
  }
}

const clonePlainJson = (value, seen = new WeakSet(), stage = 'input') => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) failInput(stage)
    return value
  }
  if (!value || typeof value !== 'object') failInput(stage)
  if (seen.has(value)) failInput(stage)
  seen.add(value)

  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) failInput(stage)
    return value.map((entry) => clonePlainJson(entry, seen, stage))
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) failInput(stage)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const result = Object.create(null)
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (UNSAFE_KEYS.has(key) || !descriptor.enumerable || descriptor.get || descriptor.set || !('value' in descriptor)) {
      failInput(stage)
    }
    result[key] = clonePlainJson(descriptor.value, seen, stage)
  }
  return result
}

export const jsonByteLength = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8')

export const createProfessionalRenderWorkerRequest = (payload) => {
  const safePayload = clonePlainJson(payload)
  if (jsonByteLength(safePayload) > PROFESSIONAL_RENDER_WORKER_LIMITS.payloadBytes) failInput('payload-limit')
  const request = {
    protocolVersion: PROFESSIONAL_RENDER_WORKER_PROTOCOL_VERSION,
    requestId: randomUUID(),
    jobType: PROFESSIONAL_RENDER_WORKER_JOB_TYPE,
    payload: safePayload,
  }
  if (jsonByteLength(request) > PROFESSIONAL_RENDER_WORKER_LIMITS.requestBytes) failInput('request-limit')
  return request
}

export const validateProfessionalRenderWorkerRequest = (request) => {
  assertExactKeys(request, ['protocolVersion', 'requestId', 'jobType', 'payload'], 'request-schema')
  if (
    request.protocolVersion !== PROFESSIONAL_RENDER_WORKER_PROTOCOL_VERSION
    || request.jobType !== PROFESSIONAL_RENDER_WORKER_JOB_TYPE
    || !UUID_PATTERN.test(request.requestId)
  ) failInput('request-identity')
  const payload = clonePlainJson(request.payload, new WeakSet(), 'request-payload')
  if (jsonByteLength(payload) > PROFESSIONAL_RENDER_WORKER_LIMITS.payloadBytes) failInput('payload-limit')
  if (jsonByteLength(request) > PROFESSIONAL_RENDER_WORKER_LIMITS.requestBytes) failInput('request-limit')
  return { ...request, payload }
}

const isPositiveInteger = (value) => Number.isInteger(value) && value >= 0

export const validateProfessionalRenderWorkerResponse = (response, requestId) => {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw createProfessionalRenderWorkerError()
  }
  if (jsonByteLength(response) > PROFESSIONAL_RENDER_WORKER_LIMITS.responseBytes) {
    throw createProfessionalRenderWorkerError({
      code: PROFESSIONAL_RENDER_WORKER_ERROR_CODES.OUTPUT_LIMIT,
      reason: PROFESSIONAL_RENDER_WORKER_ERROR_REASONS.OUTPUT_LIMIT,
      stage: 'response-limit',
    })
  }
  if (
    response.protocolVersion !== PROFESSIONAL_RENDER_WORKER_PROTOCOL_VERSION
    || response.requestId !== requestId
  ) throw createProfessionalRenderWorkerError({ stage: 'response-identity' })

  if (response.status === 'FAILED') {
    assertExactKeys(response, ['protocolVersion', 'requestId', 'status', 'error'], 'response-failure', failResponse)
    assertExactKeys(response.error, ['code', 'reason', 'message', 'details'], 'response-error', failResponse)
    assertExactKeys(
      response.error.details,
      ['stage', 'contentIncludedInError'],
      'response-error-details',
      failResponse,
    )
    if (
      response.error.code !== PROFESSIONAL_RENDER_WORKER_ERROR_CODES.RENDER_FAILED
      || response.error.reason !== PROFESSIONAL_RENDER_WORKER_ERROR_REASONS.RENDER_FAILED
      || response.error.message !== ERROR_MESSAGE
      || response.error.details.contentIncludedInError !== false
      || response.error.details.stage !== 'worker-render'
    ) throw createProfessionalRenderWorkerError({ stage: 'response-error' })
    throw createProfessionalRenderWorkerError({
      code: PROFESSIONAL_RENDER_WORKER_ERROR_CODES.RENDER_FAILED,
      reason: PROFESSIONAL_RENDER_WORKER_ERROR_REASONS.RENDER_FAILED,
      stage: 'worker-render',
    })
  }

  assertExactKeys(
    response,
    ['protocolVersion', 'requestId', 'status', 'outputBase64', 'metadata'],
    'response-success',
    failResponse,
  )
  if (response.status !== 'SUCCEEDED' || typeof response.outputBase64 !== 'string') {
    throw createProfessionalRenderWorkerError({ stage: 'response-status' })
  }
  if (!BASE64_PATTERN.test(response.outputBase64)) {
    throw createProfessionalRenderWorkerError({ stage: 'response-base64' })
  }
  assertExactKeys(
    response.metadata,
    ['mimeType', 'extension', 'outputBytes', 'sha256', 'width', 'height', 'textNodeCount', 'visibleWordCount'],
    'response-metadata',
    failResponse,
  )
  if (
    response.metadata.mimeType !== 'image/svg+xml'
    || response.metadata.extension !== 'svg'
    || !SHA256_PATTERN.test(response.metadata.sha256)
    || !['outputBytes', 'width', 'height', 'textNodeCount', 'visibleWordCount']
      .every((key) => isPositiveInteger(response.metadata[key]))
    || jsonByteLength(response.metadata) > PROFESSIONAL_RENDER_WORKER_LIMITS.metadataBytes
  ) throw createProfessionalRenderWorkerError({ stage: 'response-metadata' })

  const decoded = Buffer.from(response.outputBase64, 'base64')
  if (
    decoded.length > PROFESSIONAL_RENDER_WORKER_LIMITS.decodedOutputBytes
    || decoded.toString('base64') !== response.outputBase64
  ) {
    throw createProfessionalRenderWorkerError({
      code: PROFESSIONAL_RENDER_WORKER_ERROR_CODES.OUTPUT_LIMIT,
      reason: PROFESSIONAL_RENDER_WORKER_ERROR_REASONS.OUTPUT_LIMIT,
      stage: 'decoded-output-limit',
    })
  }
  return { buffer: Buffer.from(decoded), metadata: Object.freeze({ ...response.metadata }) }
}

export const buildProfessionalRenderWorkerSuccess = ({ requestId, buffer, metadata }) => {
  const output = Buffer.from(buffer)
  const response = {
    protocolVersion: PROFESSIONAL_RENDER_WORKER_PROTOCOL_VERSION,
    requestId,
    status: 'SUCCEEDED',
    outputBase64: output.toString('base64'),
    metadata: {
      ...metadata,
      outputBytes: output.length,
      sha256: createHash('sha256').update(output).digest('hex'),
    },
  }
  if (
    output.length > PROFESSIONAL_RENDER_WORKER_LIMITS.decodedOutputBytes
    || jsonByteLength(response.metadata) > PROFESSIONAL_RENDER_WORKER_LIMITS.metadataBytes
    || jsonByteLength(response) > PROFESSIONAL_RENDER_WORKER_LIMITS.responseBytes
  ) {
    throw createProfessionalRenderWorkerError({
      code: PROFESSIONAL_RENDER_WORKER_ERROR_CODES.OUTPUT_LIMIT,
      reason: PROFESSIONAL_RENDER_WORKER_ERROR_REASONS.OUTPUT_LIMIT,
      stage: 'worker-output-limit',
    })
  }
  return response
}

export const buildProfessionalRenderWorkerFailure = ({ requestId, stage = 'worker-render' }) => ({
  protocolVersion: PROFESSIONAL_RENDER_WORKER_PROTOCOL_VERSION,
  requestId,
  status: 'FAILED',
  error: {
    code: PROFESSIONAL_RENDER_WORKER_ERROR_CODES.RENDER_FAILED,
    reason: PROFESSIONAL_RENDER_WORKER_ERROR_REASONS.RENDER_FAILED,
    message: ERROR_MESSAGE,
    details: {
      stage,
      contentIncludedInError: false,
    },
  },
})

export const installProfessionalRenderWorkerNetworkApiDenial = () => {
  const deny = () => {
    const error = new Error('WORKER_NETWORK_API_DENIED')
    error.code = 'WORKER_NETWORK_API_DENIED'
    throw error
  }
  globalThis.fetch = deny
  const http = moduleRequire('node:http')
  const https = moduleRequire('node:https')
  const net = moduleRequire('node:net')
  const tls = moduleRequire('node:tls')
  const dgram = moduleRequire('node:dgram')
  const dns = moduleRequire('node:dns')
  http.request = deny
  http.get = deny
  https.request = deny
  https.get = deny
  net.connect = deny
  net.createConnection = deny
  net.Socket.prototype.connect = deny
  tls.connect = deny
  dgram.createSocket = deny
  dns.lookup = deny
  dns.resolve = deny
  syncBuiltinESMExports()
}

export const __testables = Object.freeze({
  BASE64_PATTERN,
  UUID_PATTERN,
  clonePlainJson,
})
