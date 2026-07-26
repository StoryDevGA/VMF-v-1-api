import {
  buildProfessionalRenderWorkerFailure,
  buildProfessionalRenderWorkerSuccess,
  installProfessionalRenderWorkerNetworkApiDenial,
  validateProfessionalRenderWorkerRequest,
} from './professionalRenderWorkerProtocol.js'

installProfessionalRenderWorkerNetworkApiDenial()

let handled = false
process.once('message', async (rawRequest) => {
  if (handled) return
  handled = true
  let requestId = typeof rawRequest?.requestId === 'string' ? rawRequest.requestId : ''
  try {
    const request = validateProfessionalRenderWorkerRequest(rawRequest)
    requestId = request.requestId
    const { renderProfessionalInfographicSvgCandidate } = await import(
      './professionalInfographicSvgCandidateRenderer.js'
    )
    const rendered = renderProfessionalInfographicSvgCandidate(request.payload)
    const response = buildProfessionalRenderWorkerSuccess({
      requestId,
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
    process.send(response, () => process.disconnect())
  } catch {
    process.send(buildProfessionalRenderWorkerFailure({ requestId }), () => process.disconnect())
  }
})
