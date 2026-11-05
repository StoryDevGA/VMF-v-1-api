import { fork } from 'node:child_process'
import env from '../config/env.js'
import { resolveDevelopmentStartupPolicy } from '../config/developmentStartupPolicy.js'
import { trackPreviewChildClosure, terminatePreviewChild } from './docxPagePreviewProcesses.js'
import { readControlledDocxAuthority } from './controlledDocxReadAuthority.js'
import { APPROVED_DOCX_READ_VERSION, NARROW_DOCX_READ_VERSION } from './approvedDocxReadProfile.js'
import {
  CONTROLLED_DOCX_IDENTITY as fixed, CONTROLLED_DOCX_READ_LIMITS as limits,
  CONTROLLED_DOCX_READ_VERSION, CORRECTED_DOCX_READ_VERSION, controlledReadProfile,
  controlledDocxReadFailure, exactReadObject, assertControlledReadRequest,
  assertControlledReadData, attachControlledReadProvenance,
} from './controlledDocxReadContract.js'

let occupied = false
let cleanupHeld = false
export const usesControlledDocxRead = (runtimeInstanceId, config = env) =>
  config.controlledDocxReadEnabled === true && runtimeInstanceId === fixed.runtimeInstanceId
export const controlledDocxWorkerEnvironment = (corrected = false, approved = false, narrow = false) => ({
  ...process.env, CONTROLLED_DOCX_READ_ENABLED: 'true', CONTROLLED_DOCX_READ_CORRECTION_ENABLED: String(corrected),
  CONTROLLED_DOCX_READ_APPROVED_ENABLED: String(approved), CONTROLLED_DOCX_READ_NARROW_ENABLED: String(narrow), NODE_OPTIONS: '', LOG_LEVEL: 'silent',
  OUTCOME_STUDIO_PROVIDER_ENABLED: 'false', VMF_SECTION_REASONING_PROVIDER_ENABLED: 'false',
  OPENAI_API_KEY: '', OUTCOME_STUDIO_PROVIDER_API_KEY: '', VMF_SECTION_REASONING_PROVIDER_API_KEY: '',
})

export const runControlledDocxReadChild = (request, { signal, forkChild = fork } = {}) => new Promise((resolve, reject) => {
  assertControlledReadRequest(request)
  const profile = controlledReadProfile(request.contractVersion)
  if (cleanupHeld) return reject(controlledDocxReadFailure('PROCESS_CLEANUP_UNVERIFIED', 503))
  let child, timer, stopping = false, closed = false, received = false, result, failure
  const diagnostics = { stdout: 0, stderr: 0 }
  const refused = reason => controlledDocxReadFailure(reason, 503)
  const cancel = () => stop('READ_CANCELLED')
  const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
  const stop = reason => {
    if (closed || stopping) return
    stopping = true; failure = refused(reason)
    terminatePreviewChild(child, limits.closeMs).then(() => {
      cleanup()
      if (!closed) reject(failure)
    }).catch(() => { cleanupHeld = true; cleanup(); reject(refused('PROCESS_CLEANUP_UNVERIFIED')) })
  }
  try {
    if (signal?.aborted) return reject(refused('READ_CANCELLED'))
    child = trackPreviewChildClosure(forkChild(new URL('./controlledDocxReadWorker.js', import.meta.url), [], {
      execArgv: ['--max-old-space-size=384'], env: controlledDocxWorkerEnvironment(profile.corrected, profile.approved === true, profile.narrow === true),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
    }))
    timer = setTimeout(() => stop('READ_DEADLINE'), limits.deadlineMs)
    signal?.addEventListener('abort', cancel, { once: true })
    for (const name of ['stdout', 'stderr']) child[name]?.on('data', chunk => {
      diagnostics[name] += chunk.length
      if (diagnostics[name] > limits.diagnosticsBytes) stop('WORKER_OUTPUT_LIMIT')
    })
    child.on('message', message => {
      if (received || closed || stopping) { stop('WORKER_MESSAGE_INVALID'); return }
      received = true
      try {
        if (Buffer.byteLength(JSON.stringify(message)) > limits.resultBytes
          || !exactReadObject(message, ['contractVersion', 'operation', 'status', ...(message?.status === 'SUCCESS' ? ['data'] : ['code', 'reason'])])
          || message.contractVersion !== profile.resultVersion || message.operation !== request.operation) throw refused('WORKER_MESSAGE_INVALID')
        if (message.status !== 'SUCCESS') {
          if (message.status !== 'REFUSED' || message.code !== 'CONTROLLED_DOCX_READ_UNAVAILABLE'
            || !['SOURCE_UNAVAILABLE', 'FENCE_REJECTED', 'REQUEST_INVALID'].includes(message.reason)) throw refused('WORKER_MESSAGE_INVALID')
          failure = refused(message.reason)
        } else result = assertControlledReadData(request.operation, message.data, request.contractVersion)
      } catch { stop('WORKER_MESSAGE_INVALID') }
    })
    child.once('error', () => stop('WORKER_START_FAILED'))
    child.once('close', (code, exitSignal) => {
      closed = true; cleanup()
      if (failure || code !== 0 || exitSignal || !received || !result || signal?.aborted) reject(failure || refused('WORKER_EXIT_INVALID'))
      else resolve(result)
    })
    if (!child.pid) stop('WORKER_START_FAILED')
    else child.send(request, error => { if (error) stop('WORKER_SEND_FAILED') })
  } catch { cleanup(); if (child?.pid) stop('WORKER_START_FAILED'); else reject(refused('WORKER_START_FAILED')) }
})

export const readControlledDocx = async (args, deps = {}) => {
  const config = deps.env || env
  resolveDevelopmentStartupPolicy(config)
  if (!usesControlledDocxRead(args.runtimeInstanceId, config)) throw controlledDocxReadFailure('CONTROLLED_READ_DISABLED')
  const scope = Object.fromEntries(['actorUserId', 'customerId', 'tenantId', 'runtimeInstanceId'].map(key => [key, args[key]]))
  const request = { contractVersion: config.controlledDocxReadNarrowEnabled === true ? NARROW_DOCX_READ_VERSION
    : config.controlledDocxReadApprovedEnabled === true ? APPROVED_DOCX_READ_VERSION
    : config.controlledDocxReadCorrectionEnabled === true ? CORRECTED_DOCX_READ_VERSION : CONTROLLED_DOCX_READ_VERSION, operation: args.operation, scope,
    ...(args.operation === 'CURRENT_PREVIEW' ? { candidateId: args.candidateId } : {}) }
  assertControlledReadRequest(request)
  if (occupied) throw controlledDocxReadFailure('CONTROLLED_READ_BUSY', 429)
  occupied = true
  // Capture one original bearer for the whole read. No token crosses IPC.
  const authorityArgs = { ...scope, authorization: args.authorization }
  try {
    if (args.signal?.aborted) throw controlledDocxReadFailure('READ_CANCELLED')
    const authority = deps.readAuthority || readControlledDocxAuthority
    const before = await authority(authorityArgs)
    if (before?.actorUserId !== fixed.actorUserId || !/^[a-f0-9]{64}$/.test(before?.fingerprint || '')) throw controlledDocxReadFailure('NATIVE_AUTHORITY_INVALID', 403)
    const data = await (deps.runChild || runControlledDocxReadChild)(request, { signal: args.signal })
    assertControlledReadData(request.operation, data, request.contractVersion)
    const after = await authority(authorityArgs)
    if (after?.actorUserId !== before.actorUserId
      || before.fingerprint !== after.fingerprint || args.signal?.aborted) throw controlledDocxReadFailure('NATIVE_AUTHORITY_CHANGED', 403)
    return attachControlledReadProvenance(request.operation, data)
  } finally { occupied = false }
}

export const createControlledDocxReadRequestHandler = (deps = {}) => async (req, res, operation) => {
  const query = new URL(req.originalUrl || req.url, 'http://localhost').searchParams
  if (req.method !== 'GET' || [...query.keys()].length !== 2
    || [...query.keys()].some(key => !['customerId', 'tenantId'].includes(key))
    || query.getAll('customerId').length !== 1 || query.getAll('tenantId').length !== 1
    || query.get('customerId') !== fixed.customerId || query.get('tenantId') !== fixed.tenantId) throw controlledDocxReadFailure('REQUEST_SCOPE_INVALID', 403)
  const abort = new AbortController()
  const disconnected = () => { if (!res.writableEnded) abort.abort() }
  res.once('close', disconnected)
  try {
    return await readControlledDocx({ operation, actorUserId: req.context?.userId || req.userId,
      customerId: req.query.customerId, tenantId: req.query.tenantId,
      runtimeInstanceId: req.params.runtimeInstanceId, candidateId: req.params.candidateId,
      authorization: req.headers.authorization, signal: abort.signal }, deps)
  } finally { res.off('close', disconnected) }
}
export const readControlledDocxForRequest = createControlledDocxReadRequestHandler()
