import { createHash } from 'node:crypto'
import { fork } from 'node:child_process'
import { EventEmitter } from 'node:events'
import http from 'node:http'
import dgram from 'node:dgram'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from '@jest/globals'
import { professionalInfographicSvgCandidateFixture } from '../testFixtures/professionalInfographicSvgCandidateFixture.js'
import {
  PROFESSIONAL_RENDER_WORKER_ERROR_CODES,
  PROFESSIONAL_RENDER_WORKER_ERROR_REASONS,
  PROFESSIONAL_RENDER_WORKER_JOB_TYPE,
  PROFESSIONAL_RENDER_WORKER_PROTOCOL_VERSION,
  __testables as protocolTestables,
  buildProfessionalRenderWorkerFailure,
  createProfessionalRenderWorkerRequest,
  validateProfessionalRenderWorkerRequest,
  validateProfessionalRenderWorkerResponse,
} from '../services/professionalRenderWorkerProtocol.js'
import {
  runProfessionalRenderWorkerJob,
  __testables as runnerTestables,
} from '../services/professionalRenderWorkerRunner.js'
import {
  listOutcomeRendererCapabilities,
  OUTCOME_RENDERER_ENGINEERING_CANDIDATES,
  resolveOutcomeRendererCapability,
} from '../services/outcomeRendererCapabilityRegistryService.js'

const probeEntrypoint = fileURLToPath(new URL('../testFixtures/professionalRenderWorkerProbeEntry.js', import.meta.url))
const cloneFixture = () => JSON.parse(JSON.stringify(professionalInfographicSvgCandidateFixture))
const runProbe = (workerProbe, options = {}) => runnerTestables
  .createRunnerForEntrypoint(probeEntrypoint, options)({ workerProbe })
const isPidAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const expectWorkerError = async (promise, code) => {
  try {
    await promise
    throw new Error('Expected worker failure.')
  } catch (error) {
    expect(error.name).toBe('ProfessionalRenderWorkerError')
    if (code) expect(error.code).toBe(code)
    expect(error.message).toBe('Professional render worker request failed.')
    expect(error.details).toEqual(expect.objectContaining({ contentIncludedInError: false }))
    expect(JSON.stringify(error)).not.toMatch(/Enterprise Knowledge|customer-secret-marker|professionalRenderWorkerProbeEntry|[A-Z]:\\/i)
  }
}

describe('Professional render worker foundation', () => {
  test('renders the real inactive SVG candidate in a separate process and recomputes evidence', async () => {
    const result = await runProfessionalRenderWorkerJob(professionalInfographicSvgCandidateFixture)
    expect(result.protocolVersion).toBe(PROFESSIONAL_RENDER_WORKER_PROTOCOL_VERSION)
    expect(result.jobType).toBe(PROFESSIONAL_RENDER_WORKER_JOB_TYPE)
    expect(result.buffer).toBeInstanceOf(Buffer)
    expect(result.metadata).toEqual({
      mimeType: 'image/svg+xml',
      extension: 'svg',
      outputBytes: result.buffer.length,
      sha256: createHash('sha256').update(result.buffer).digest('hex'),
      width: 1800,
      height: 2546,
      textNodeCount: 110,
      visibleWordCount: 296,
    })
    expect(result.validation).toEqual(expect.objectContaining({ status: 'PASSED' }))
  }, 15000)

  test('rejects unsupported, circular, shared, sparse, accessor, and toJSON input before spawn', () => {
    const invalid = [
      { value: undefined },
      { value: 1n },
      { value: Number.NaN },
      (() => { const value = {}; value.self = value; return value })(),
      (() => { const shared = {}; return { a: shared, b: shared } })(),
      (() => { const value = []; value[1] = 'x'; return value })(),
      Object.defineProperty({}, 'value', { enumerable: true, get: () => 'x' }),
      { toJSON: () => ({}) },
    ]
    invalid.forEach((value) => expect(() => createProfessionalRenderWorkerRequest(value)).toThrow(
      expect.objectContaining({ code: PROFESSIONAL_RENDER_WORKER_ERROR_CODES.INPUT_INVALID }),
    ))
  })

  test('rejects one-byte payload overflow before spawn', () => {
    const payload = { value: 'x'.repeat(262144) }
    expect(() => createProfessionalRenderWorkerRequest(payload)).toThrow(
      expect.objectContaining({ code: PROFESSIONAL_RENDER_WORKER_ERROR_CODES.INPUT_INVALID }),
    )
  })

  test.each([
    ['CRASH', PROFESSIONAL_RENDER_WORKER_ERROR_CODES.EXITED],
    ['SIGNAL_EXIT', PROFESSIONAL_RENDER_WORKER_ERROR_CODES.EXITED],
    ['DISCONNECT', PROFESSIONAL_RENDER_WORKER_ERROR_CODES.EXITED],
    ['MISMATCH', PROFESSIONAL_RENDER_WORKER_ERROR_CODES.RESPONSE_INVALID],
    ['MALFORMED', PROFESSIONAL_RENDER_WORKER_ERROR_CODES.RESPONSE_INVALID],
    ['WORKER_FAILURE', PROFESSIONAL_RENDER_WORKER_ERROR_CODES.RENDER_FAILED],
    ['OVERSIZE', PROFESSIONAL_RENDER_WORKER_ERROR_CODES.OUTPUT_LIMIT],
  ])('fails closed for %s probe', async (probe, code) => {
    await expectWorkerError(runProbe(probe), code)
  })

  test('times out and terminates a hanging worker', async () => {
    await expectWorkerError(runProbe('HANG', { timeoutMs: 50 }), PROFESSIONAL_RENDER_WORKER_ERROR_CODES.TIMEOUT)
  })

  test('confirms exact spawned PIDs exit after success and timeout', async () => {
    const pids = []
    const recordingFork = (...args) => {
      const child = fork(...args)
      pids.push(child.pid)
      return child
    }
    const successRunner = runnerTestables.createRunnerForEntrypoint(
      runnerTestables.PRODUCTION_ENTRYPOINT,
      { forkImpl: recordingFork },
    )
    await successRunner(professionalInfographicSvgCandidateFixture)
    const timeoutRunner = runnerTestables.createRunnerForEntrypoint(
      probeEntrypoint,
      { forkImpl: recordingFork, timeoutMs: 50 },
    )
    await expectWorkerError(timeoutRunner({ workerProbe: 'HANG' }), PROFESSIONAL_RENDER_WORKER_ERROR_CODES.TIMEOUT)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(pids).toHaveLength(2)
    expect(pids.every((pid) => !isPidAlive(pid))).toBe(true)
  }, 15000)

  test('confirms exact PIDs exit across crash, signal, disconnect, mismatch, oversize, duplicate, and send failures', async () => {
    const pids = []
    const recordingFork = (...args) => {
      const child = fork(...args)
      pids.push(child.pid)
      return child
    }
    const cases = [
      ['CRASH', PROFESSIONAL_RENDER_WORKER_ERROR_CODES.EXITED],
      ['SIGNAL_EXIT', PROFESSIONAL_RENDER_WORKER_ERROR_CODES.EXITED],
      ['DISCONNECT', PROFESSIONAL_RENDER_WORKER_ERROR_CODES.EXITED],
      ['MISMATCH', PROFESSIONAL_RENDER_WORKER_ERROR_CODES.RESPONSE_INVALID],
      ['MALFORMED', PROFESSIONAL_RENDER_WORKER_ERROR_CODES.RESPONSE_INVALID],
      ['WORKER_FAILURE', PROFESSIONAL_RENDER_WORKER_ERROR_CODES.RENDER_FAILED],
      ['OVERSIZE', PROFESSIONAL_RENDER_WORKER_ERROR_CODES.OUTPUT_LIMIT],
    ]
    for (const [workerProbe, code] of cases) {
      const runner = runnerTestables.createRunnerForEntrypoint(probeEntrypoint, { forkImpl: recordingFork })
      await expectWorkerError(runner({ workerProbe }), code)
    }
    const duplicateRunner = runnerTestables.createRunnerForEntrypoint(probeEntrypoint, { forkImpl: recordingFork })
    await expectWorkerError(
      duplicateRunner({ workerProbe: 'DUPLICATE_VALID', fixture: professionalInfographicSvgCandidateFixture }),
      PROFESSIONAL_RENDER_WORKER_ERROR_CODES.RESPONSE_INVALID,
    )
    const syncSendRunner = runnerTestables.createRunnerForEntrypoint(probeEntrypoint, {
      forkImpl: (...args) => {
        const child = recordingFork(...args)
        child.send = () => { throw new Error('native ipc detail') }
        return child
      },
    })
    await expectWorkerError(syncSendRunner({ workerProbe: 'HANG' }), PROFESSIONAL_RENDER_WORKER_ERROR_CODES.SEND_FAILED)
    const callbackSendRunner = runnerTestables.createRunnerForEntrypoint(probeEntrypoint, {
      forkImpl: (...args) => {
        const child = recordingFork(...args)
        child.send = (_message, callback) => queueMicrotask(() => callback(new Error('native ipc detail')))
        return child
      },
    })
    await expectWorkerError(callbackSendRunner({ workerProbe: 'HANG' }), PROFESSIONAL_RENDER_WORKER_ERROR_CODES.SEND_FAILED)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(pids).toHaveLength(10)
    expect(pids.every((pid) => !isPidAlive(pid))).toBe(true)
  }, 30000)

  test('waits for a clean worker exit after receiving a valid response', async () => {
    const pids = []
    const runner = runnerTestables.createRunnerForEntrypoint(probeEntrypoint, {
      forkImpl: (...args) => {
        const child = fork(...args)
        pids.push(child.pid)
        return child
      },
    })
    const startedAt = Date.now()
    const result = await runner({
      workerProbe: 'RESPONSE_BEFORE_EXIT',
      fixture: professionalInfographicSvgCandidateFixture,
    })
    expect(result.validation.status).toBe('PASSED')
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(125)
    expect(pids.every((pid) => !isPidAlive(pid))).toBe(true)
  }, 15000)

  test('maps spawn and cleanup-confirmation failures to stable errors', async () => {
    const spawnFailureRunner = runnerTestables.createRunnerForEntrypoint(probeEntrypoint, {
      forkImpl: () => { throw new Error('native spawn detail') },
    })
    await expectWorkerError(
      spawnFailureRunner({ workerProbe: 'HANG' }),
      PROFESSIONAL_RENDER_WORKER_ERROR_CODES.SPAWN_FAILED,
    )

    const cleanupFailureRunner = runnerTestables.createRunnerForEntrypoint(probeEntrypoint, {
      forkImpl: () => {
        const child = new EventEmitter()
        child.pid = 2147483647
        child.connected = true
        child.exitCode = null
        child.signalCode = null
        child.disconnect = () => { child.connected = false }
        child.kill = () => false
        child.send = (_message, callback) => callback(new Error('native send detail'))
        return child
      },
    })
    await expectWorkerError(
      cleanupFailureRunner({ workerProbe: 'HANG' }),
      PROFESSIONAL_RENDER_WORKER_ERROR_CODES.CLEANUP_FAILED,
    )
  }, 10000)

  test('classifies malformed responses separately from invalid caller input', () => {
    const request = createProfessionalRenderWorkerRequest({})
    expect(() => validateProfessionalRenderWorkerRequest({
      ...request,
      jobType: 'UNKNOWN',
    })).toThrow(expect.objectContaining({
      code: PROFESSIONAL_RENDER_WORKER_ERROR_CODES.INPUT_INVALID,
    }))
    expect(() => validateProfessionalRenderWorkerResponse({
      protocolVersion: PROFESSIONAL_RENDER_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      status: 'SUCCEEDED',
      outputBase64: '',
      metadata: {},
      extra: true,
    }, request.requestId)).toThrow(expect.objectContaining({
      code: PROFESSIONAL_RENDER_WORKER_ERROR_CODES.RESPONSE_INVALID,
      reason: PROFESSIONAL_RENDER_WORKER_ERROR_REASONS.RESPONSE_INVALID,
    }))
  })

  test('enforces closed worker failure code, reason, and stage allowlists', () => {
    const request = createProfessionalRenderWorkerRequest({})
    const valid = buildProfessionalRenderWorkerFailure({ requestId: request.requestId })
    expect(() => validateProfessionalRenderWorkerResponse(valid, request.requestId)).toThrow(
      expect.objectContaining({ code: PROFESSIONAL_RENDER_WORKER_ERROR_CODES.RENDER_FAILED }),
    )
    ;[
      { ...valid, error: { ...valid.error, code: 'ARBITRARY' } },
      { ...valid, error: { ...valid.error, reason: 'ARBITRARY' } },
      { ...valid, error: { ...valid.error, details: { ...valid.error.details, stage: 'arbitrary' } } },
    ].forEach((response) => expect(() => validateProfessionalRenderWorkerResponse(
      response,
      request.requestId,
    )).toThrow(expect.objectContaining({
      code: PROFESSIONAL_RENDER_WORKER_ERROR_CODES.RESPONSE_INVALID,
    })))
  })

  test('uses a positive child environment allowlist without inherited secrets or debug flags', () => {
    const previous = {
      NODE_OPTIONS: process.env.NODE_OPTIONS,
      HTTPS_PROXY: process.env.HTTPS_PROXY,
      DATABASE_URL: process.env.DATABASE_URL,
    }
    process.env.NODE_OPTIONS = '--inspect=9229'
    process.env.HTTPS_PROXY = 'http://customer-secret-marker'
    process.env.DATABASE_URL = 'customer-secret-marker'
    try {
      const environment = runnerTestables.buildWorkerEnvironment()
      expect(Object.keys(environment).sort()).toEqual(expect.arrayContaining(['LANG', 'NODE_ENV', 'STORYLINEOS_RENDER_WORKER', 'TZ']))
      expect(environment).not.toHaveProperty('NODE_OPTIONS')
      expect(environment).not.toHaveProperty('HTTPS_PROXY')
      expect(environment).not.toHaveProperty('DATABASE_URL')
    } finally {
      Object.entries(previous).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
    }
  })

  test('denies guarded network APIs before a listening loopback canary accepts traffic', async () => {
    let acceptedConnections = 0
    let acceptedRequests = 0
    let acceptedDatagrams = 0
    const server = http.createServer((_request, response) => {
      acceptedRequests += 1
      response.end('unexpected')
    })
    server.on('connection', () => { acceptedConnections += 1 })
    const udp = dgram.createSocket('udp4')
    udp.on('message', () => { acceptedDatagrams += 1 })
    await Promise.all([
      new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)),
      new Promise((resolve) => udp.bind(0, '127.0.0.1', resolve)),
    ])
    const port = server.address().port
    const udpPort = udp.address().port
    const child = fork(probeEntrypoint, [], {
      cwd: runnerTestables.API_ROOT,
      env: runnerTestables.buildWorkerEnvironment(),
      execPath: process.execPath,
      execArgv: [],
      serialization: 'json',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      windowsHide: true,
    })
    try {
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Network denial probe timed out.')), 5000)
        child.once('error', reject)
        child.once('message', (message) => {
          clearTimeout(timer)
          resolve(message)
        })
        child.send({
          protocolVersion: PROFESSIONAL_RENDER_WORKER_PROTOCOL_VERSION,
          requestId: createProfessionalRenderWorkerRequest({}).requestId,
          jobType: PROFESSIONAL_RENDER_WORKER_JOB_TYPE,
          payload: { workerProbe: 'NETWORK_DENIAL', port, udpPort },
        })
      })
      expect(result).toEqual({
        type: 'NETWORK_DENIAL_RESULT',
        codes: Array(8).fill('WORKER_NETWORK_API_DENIED'),
      })
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect({ acceptedConnections, acceptedRequests, acceptedDatagrams }).toEqual({
        acceptedConnections: 0,
        acceptedRequests: 0,
        acceptedDatagrams: 0,
      })
    } finally {
      if (child.connected) child.disconnect()
      child.kill('SIGTERM')
      await Promise.all([
        new Promise((resolve) => server.close(resolve)),
        new Promise((resolve) => udp.close(resolve)),
      ])
    }
  }, 15000)

  test('keeps the production entrypoint fixed and test probes outside production source', async () => {
    expect(runnerTestables.PRODUCTION_ENTRYPOINT).toMatch(/professionalRenderWorkerEntry\.js$/)
    expect(runnerTestables.PRODUCTION_ENTRYPOINT).not.toContain('__tests__')
    expect(protocolTestables.UUID_PATTERN.test(createProfessionalRenderWorkerRequest({}).requestId)).toBe(true)
  })

  test('does not activate or expose any engineering candidate', () => {
    expect(OUTCOME_RENDERER_ENGINEERING_CANDIDATES).toHaveLength(7)
    expect(OUTCOME_RENDERER_ENGINEERING_CANDIDATES.every(
      (candidate) => candidate.lifecycleStatus === 'ENGINEERING_CANDIDATE' && candidate.rolloutScopes.length === 0,
    )).toBe(true)
    expect(listOutcomeRendererCapabilities().capabilities).toHaveLength(1)
    expect(resolveOutcomeRendererCapability({
      outputTypeKey: 'infographic',
      outputSchemaKey: 'executive-infographic',
      styleKey: 'executive-style',
      format: 'SVG',
    })).toEqual({ status: 'UNSUPPORTED', reason: 'RENDER_FORMAT_UNSUPPORTED', capability: null })
  })

  test('does not mutate the source payload', async () => {
    const fixture = cloneFixture()
    const before = JSON.stringify(fixture)
    await runProfessionalRenderWorkerJob(fixture)
    expect(JSON.stringify(fixture)).toBe(before)
  }, 15000)
})
