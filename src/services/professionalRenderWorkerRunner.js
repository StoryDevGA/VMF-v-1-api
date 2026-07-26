import { createHash } from 'node:crypto'
import { fork, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  createProfessionalRenderWorkerError,
  createProfessionalRenderWorkerRequest,
  PROFESSIONAL_RENDER_WORKER_ERROR_CODES,
  PROFESSIONAL_RENDER_WORKER_ERROR_REASONS,
  PROFESSIONAL_RENDER_WORKER_JOB_TYPE,
  PROFESSIONAL_RENDER_WORKER_LIMITS,
  PROFESSIONAL_RENDER_WORKER_PROTOCOL_VERSION,
  validateProfessionalRenderWorkerResponse,
} from './professionalRenderWorkerProtocol.js'
import { validateProfessionalInfographicSvgCandidate } from './professionalInfographicSvgCandidateRenderer.js'

const PRODUCTION_ENTRYPOINT = fileURLToPath(new URL('./professionalRenderWorkerEntry.js', import.meta.url))
const API_ROOT = fileURLToPath(new URL('../..', import.meta.url))

const buildWorkerEnvironment = () => {
  const environment = {
    NODE_ENV: 'production',
    STORYLINEOS_RENDER_WORKER: '1',
    LANG: 'C',
    TZ: 'UTC',
  }
  if (process.platform === 'win32') {
    if (process.env.SystemRoot) environment.SystemRoot = process.env.SystemRoot
    if (process.env.WINDIR) environment.WINDIR = process.env.WINDIR
  }
  return environment
}

const waitForExit = (child, timeoutMs) => new Promise((resolve) => {
  if (child.exitCode !== null || child.signalCode !== null) return resolve(true)
  const timer = setTimeout(() => {
    child.off('exit', onExit)
    resolve(false)
  }, timeoutMs)
  const onExit = () => {
    clearTimeout(timer)
    resolve(true)
  }
  child.once('exit', onExit)
})

const forceKillWindows = (pid) => new Promise((resolve) => {
  const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
  })
  killer.once('error', () => resolve())
  killer.once('exit', () => resolve())
})

const terminateChild = async (child) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true
  try {
    if (child.connected) child.disconnect()
  } catch {
    // Continue to process termination.
  }
  child.kill('SIGTERM')
  if (await waitForExit(child, PROFESSIONAL_RENDER_WORKER_LIMITS.terminationGraceMs)) return true
  if (process.platform === 'win32') await forceKillWindows(child.pid)
  else child.kill('SIGKILL')
  return waitForExit(child, PROFESSIONAL_RENDER_WORKER_LIMITS.terminationConfirmationMs)
}

const createRunner = ({
  entrypoint,
  forkImpl = fork,
  timeoutMs = PROFESSIONAL_RENDER_WORKER_LIMITS.operationTimeoutMs,
} = {}) => async (payload) => {
  let request
  try {
    request = createProfessionalRenderWorkerRequest(payload)
  } catch (error) {
    if (error?.name === 'ProfessionalRenderWorkerError') throw error
    throw createProfessionalRenderWorkerError({
      code: PROFESSIONAL_RENDER_WORKER_ERROR_CODES.INPUT_INVALID,
      reason: PROFESSIONAL_RENDER_WORKER_ERROR_REASONS.INPUT_INVALID,
      stage: 'input',
    })
  }

  return new Promise((resolve, reject) => {
    let child
    let timer
    let responseCandidate = null
    let terminal = false
    let messageCount = 0

    const dispose = () => {
      clearTimeout(timer)
      if (!child) return
      child.removeAllListeners('message')
      child.removeAllListeners('error')
      child.removeAllListeners('disconnect')
      child.removeAllListeners('exit')
    }

    const rejectAfterCleanup = async (error) => {
      if (terminal) return
      terminal = true
      clearTimeout(timer)
      const cleaned = await terminateChild(child)
      dispose()
      if (!cleaned) {
        reject(createProfessionalRenderWorkerError({
          code: PROFESSIONAL_RENDER_WORKER_ERROR_CODES.CLEANUP_FAILED,
          reason: PROFESSIONAL_RENDER_WORKER_ERROR_REASONS.CLEANUP_FAILED,
          stage: 'cleanup',
        }))
        return
      }
      reject(error)
    }

    const fail = (code, reason, stage) => rejectAfterCleanup(
      createProfessionalRenderWorkerError({ code, reason, stage }),
    )

    try {
      child = forkImpl(entrypoint, [], {
        cwd: API_ROOT,
        env: buildWorkerEnvironment(),
        execPath: process.execPath,
        execArgv: [],
        serialization: 'json',
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        windowsHide: true,
      })
    } catch {
      fail(
        PROFESSIONAL_RENDER_WORKER_ERROR_CODES.SPAWN_FAILED,
        PROFESSIONAL_RENDER_WORKER_ERROR_REASONS.SPAWN_FAILED,
        'spawn',
      )
      return
    }

    timer = setTimeout(() => fail(
      PROFESSIONAL_RENDER_WORKER_ERROR_CODES.TIMEOUT,
      PROFESSIONAL_RENDER_WORKER_ERROR_REASONS.TIMEOUT,
      'timeout',
    ), timeoutMs)

    child.on('message', (response) => {
      if (terminal) return
      messageCount += 1
      if (messageCount !== 1) {
        fail(
          PROFESSIONAL_RENDER_WORKER_ERROR_CODES.RESPONSE_INVALID,
          PROFESSIONAL_RENDER_WORKER_ERROR_REASONS.RESPONSE_INVALID,
          'duplicate-response',
        )
        return
      }
      try {
        responseCandidate = validateProfessionalRenderWorkerResponse(response, request.requestId)
      } catch (error) {
        rejectAfterCleanup(error)
      }
    })

    child.once('error', () => fail(
      PROFESSIONAL_RENDER_WORKER_ERROR_CODES.SPAWN_FAILED,
      PROFESSIONAL_RENDER_WORKER_ERROR_REASONS.SPAWN_FAILED,
      'child-error',
    ))

    child.once('disconnect', () => {
      if (!terminal && !responseCandidate && child.exitCode === null) {
        fail(
          PROFESSIONAL_RENDER_WORKER_ERROR_CODES.EXITED,
          PROFESSIONAL_RENDER_WORKER_ERROR_REASONS.EXITED,
          'disconnect',
        )
      }
    })

    child.once('exit', (code, signal) => {
      if (terminal) return
      clearTimeout(timer)
      if (code !== 0 || signal || !responseCandidate) {
        fail(
          PROFESSIONAL_RENDER_WORKER_ERROR_CODES.EXITED,
          PROFESSIONAL_RENDER_WORKER_ERROR_REASONS.EXITED,
          'exit',
        )
        return
      }
      try {
        const validation = validateProfessionalInfographicSvgCandidate(responseCandidate.buffer)
        const metadata = Object.freeze({
          mimeType: 'image/svg+xml',
          extension: 'svg',
          outputBytes: responseCandidate.buffer.length,
          sha256: createHash('sha256').update(responseCandidate.buffer).digest('hex'),
          width: validation.width,
          height: validation.height,
          textNodeCount: validation.textNodeCount,
          visibleWordCount: validation.visibleWordCount,
        })
        if (Object.entries(metadata).some(([key, value]) => responseCandidate.metadata[key] !== value)) {
          throw createProfessionalRenderWorkerError({ stage: 'metadata-mismatch' })
        }
        terminal = true
        dispose()
        resolve(Object.freeze({
          buffer: Buffer.from(responseCandidate.buffer),
          metadata,
          validation: Object.freeze({ ...validation }),
          protocolVersion: PROFESSIONAL_RENDER_WORKER_PROTOCOL_VERSION,
          jobType: PROFESSIONAL_RENDER_WORKER_JOB_TYPE,
        }))
      } catch (error) {
        terminal = false
        rejectAfterCleanup(error?.name === 'ProfessionalRenderWorkerError'
          ? error
          : createProfessionalRenderWorkerError({ stage: 'parent-validation' }))
      }
    })

    try {
      child.send(request, (error) => {
        if (!error) return
        fail(
          PROFESSIONAL_RENDER_WORKER_ERROR_CODES.SEND_FAILED,
          PROFESSIONAL_RENDER_WORKER_ERROR_REASONS.SEND_FAILED,
          'send',
        )
      })
    } catch {
      fail(
        PROFESSIONAL_RENDER_WORKER_ERROR_CODES.SEND_FAILED,
        PROFESSIONAL_RENDER_WORKER_ERROR_REASONS.SEND_FAILED,
        'send',
      )
    }
  })
}

export const runProfessionalRenderWorkerJob = createRunner({ entrypoint: PRODUCTION_ENTRYPOINT })

export const __testables = Object.freeze({
  API_ROOT,
  PRODUCTION_ENTRYPOINT,
  buildWorkerEnvironment,
  createRunnerForEntrypoint: (entrypoint, options = {}) => createRunner({ entrypoint, ...options }),
  terminateChild,
})
