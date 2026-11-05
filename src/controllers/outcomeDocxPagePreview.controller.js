import { buildRuntimeStateRequestScopes } from './runtimeInstance.controller.js'
import { createDocxPagePreview, readCurrentDocxPagePreview, readDocxPagePreview } from '../services/outcomeDocxPagePreviewPersistenceService.js'
import { DOCX_PREVIEW_RESPONSE_LIMIT, docxPreviewFailure } from '../services/outcomeDocxPagePreviewRecordContract.js'
import { readControlledDocxForRequest, usesControlledDocxRead } from '../services/controlledDocxReadService.js'

const handle = (operation, includePages = false, controlledBundle = false) => async (req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  try {
    const controlled = controlledBundle && usesControlledDocxRead(req.params.runtimeInstanceId)
    const result = controlled ? await readControlledDocxForRequest(req, res, 'CURRENT_PREVIEW') : await operation({ actorUserId: req.context?.userId || req.userId,
      runtimeInstanceId: req.params.runtimeInstanceId, candidateId: req.params.candidateId, previewId: req.params.previewId,
      scopes: buildRuntimeStateRequestScopes({ scopes: req.scopes, query: req.query }), payload: req.body,
      auditRequest: req, includePages })
    let data = result
    if (includePages && result.preview && !controlled) {
      const document = result.document
      if (!document || typeof document.title !== 'string' || !document.title.trim()
        || typeof document.markdown !== 'string' || !document.markdown.trim() || Buffer.byteLength(document.markdown) > 1024 ** 2
        || document.inputFingerprint !== result.preview.inputFingerprint) throw docxPreviewFailure('PREVIEW_TEXT_UNAVAILABLE')
      data = { preview: result.preview, pages: result.pages.map((buffer, index) => ({
        number: index + 1, mimeType: 'image/png', base64: buffer.toString('base64') })),
      document: { title: document.title, markdown: document.markdown, inputFingerprint: document.inputFingerprint } }
    }
    const serialized = JSON.stringify({ data, meta: { requestId: req.requestId, version: 'v1' } })
    if (Buffer.byteLength(serialized) > DOCX_PREVIEW_RESPONSE_LIMIT) throw docxPreviewFailure('PREVIEW_RESPONSE_LIMIT')
    return res.status(200).type('json').send(serialized)
  } catch (error) {
    if (error.status && error.code) return res.status(error.status).json({ error: { code: error.code,
      message: error.message, reason: error.details?.reason, requestId: req.requestId } })
    return next(error)
  }
}
export const createDocxPagePreviewEndpoint = handle(createDocxPagePreview)
export const readCurrentDocxPagePreviewEndpoint = handle(readCurrentDocxPagePreview)
export const readDocxPagePreviewEndpoint = handle(readDocxPagePreview)
export const readDocxPagePreviewBundleEndpoint = handle(readDocxPagePreview, true)
export const readCurrentDocxPagePreviewBundleEndpoint = handle(readCurrentDocxPagePreview, true, true)
