import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import dgram from 'node:dgram'
import dns from 'node:dns'
import {
  buildProfessionalRenderWorkerFailure,
  buildProfessionalRenderWorkerSuccess,
  installProfessionalRenderWorkerNetworkApiDenial,
} from '../services/professionalRenderWorkerProtocol.js'
import { renderProfessionalInfographicSvgCandidate } from '../services/professionalInfographicSvgCandidateRenderer.js'

const send = (value, callback = () => process.disconnect()) => process.send(value, callback)

const handleProbeRequest = async (request) => {
  const probe = request?.payload?.workerProbe
  const base = {
    protocolVersion: request?.protocolVersion,
    requestId: request?.requestId,
  }
  if (probe === 'HANG') {
    setInterval(() => {}, 1000)
    return
  }
  if (probe === 'CRASH') process.exit(23)
  if (probe === 'SIGNAL_EXIT') process.kill(process.pid, 'SIGTERM')
  if (probe === 'DISCONNECT') return process.disconnect()
  if (probe === 'DUPLICATE') {
    const response = { ...base, status: 'INVALID' }
    return send(response, () => send(response))
  }
  if (probe === 'DUPLICATE_VALID') {
    const rendered = renderProfessionalInfographicSvgCandidate(request.payload.fixture)
    const response = buildProfessionalRenderWorkerSuccess({
      requestId: request.requestId,
      buffer: rendered.buffer,
      metadata: {
        mimeType: 'image/svg+xml',
        extension: 'svg',
        width: rendered.validation.width,
        height: rendered.validation.height,
        textNodeCount: rendered.validation.textNodeCount,
        visibleWordCount: rendered.validation.visibleWordCount,
      },
    })
    return send(response, () => process.send(response, () => process.disconnect()))
  }
  if (probe === 'RESPONSE_BEFORE_EXIT') {
    const rendered = renderProfessionalInfographicSvgCandidate(request.payload.fixture)
    const response = buildProfessionalRenderWorkerSuccess({
      requestId: request.requestId,
      buffer: rendered.buffer,
      metadata: {
        mimeType: 'image/svg+xml',
        extension: 'svg',
        width: rendered.validation.width,
        height: rendered.validation.height,
        textNodeCount: rendered.validation.textNodeCount,
        visibleWordCount: rendered.validation.visibleWordCount,
      },
    })
    process.send(response)
    setTimeout(() => process.disconnect(), 150)
    return
  }
  if (probe === 'MISMATCH') return send({ ...base, requestId: '00000000-0000-4000-8000-000000000000', status: 'INVALID' })
  if (probe === 'OVERSIZE') return send({ ...base, status: 'INVALID', padding: 'x'.repeat(100001) })
  if (probe === 'MALFORMED') return send({ malformed: true })
  if (probe === 'WORKER_FAILURE') {
    return send(buildProfessionalRenderWorkerFailure({ requestId: request.requestId }))
  }
  if (probe === 'ENVIRONMENT') {
    return send({
      ...base,
      status: 'FAILED',
      error: {
        code: 'PROBE',
        reason: 'PROBE',
        message: 'Professional render worker request failed.',
        details: { stage: Object.keys(process.env).sort().join(','), contentIncludedInError: false },
      },
    })
  }
  if (probe === 'NETWORK_DENIAL') {
    installProfessionalRenderWorkerNetworkApiDenial()
    const port = request.payload.port
    const udpPort = request.payload.udpPort
    const attempts = [
      () => fetch(`http://127.0.0.1:${port}/canary`),
      () => http.get(`http://127.0.0.1:${port}/canary`),
      () => https.get(`https://127.0.0.1:${port}/canary`),
      () => net.connect(port, '127.0.0.1'),
      () => tls.connect(port, '127.0.0.1'),
      () => dgram.createSocket('udp4').send('probe', udpPort, '127.0.0.1'),
      () => dns.lookup('localhost', () => {}),
      () => dns.resolve('localhost', () => {}),
    ]
    const codes = []
    for (const attempt of attempts) {
      try {
        await attempt()
        codes.push('NOT_DENIED')
      } catch (error) {
        codes.push(error?.code || 'UNKNOWN')
      }
    }
    return send({ type: 'NETWORK_DENIAL_RESULT', codes })
  }
  return send({ ...base, status: 'INVALID' })
}

process.once('message', handleProbeRequest)
