import outcomeStudioTestReferenceService from '../services/outcomeStudioTestReferenceService.js'

const envelope = (req, data, meta = {}) => ({ data, meta: { ...meta, requestId: req.requestId, version: 'v1' } })

const encodeRfc5987 = (value) => encodeURIComponent(value).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)

const replaceMalformedUtf16 = (value) => {
  let result = ''
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value[index] + value[index + 1]
        index += 1
      } else {
        result += '_'
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      result += '_'
    } else {
      result += value[index]
    }
  }
  return result
}

const safeDownloadName = (value) => {
  const original = replaceMalformedUtf16(String(value || 'outcome-studio-reference.pdf')).replace(/[\r\n"/\\]/g, '_')
  const ascii = original.replace(/[^A-Za-z0-9._-]/g, '_') || 'outcome-studio-reference.pdf'
  const fallback = ascii.length <= 150 ? ascii : `${ascii.slice(0, 146)}.pdf`
  return { fallback, encoded: encodeRfc5987(original) }
}

export const uploadOutcomeStudioTestReference = async (req, res, next) => {
  try {
    const data = await outcomeStudioTestReferenceService.uploadOutcomeStudioTestReference({ payload: req.validatedOutcomeStudioTestReferenceUpload, request: req })
    res.status(201).json(envelope(req, data))
  } catch (error) { next(error) }
}

export const listOutcomeStudioTestReferences = async (req, res, next) => {
  try {
    const result = await outcomeStudioTestReferenceService.listOutcomeStudioTestReferences(req.validatedOutcomeStudioTestReferencePagination)
    res.status(200).json(envelope(req, result.items, { page: result.page, pageSize: result.pageSize, total: result.total, totalPages: result.totalPages }))
  } catch (error) { next(error) }
}

export const getOutcomeStudioTestReference = async (req, res, next) => {
  try {
    const data = await outcomeStudioTestReferenceService.getOutcomeStudioTestReference(req.validatedOutcomeStudioTestReferenceKey)
    res.status(200).json(envelope(req, data))
  } catch (error) { next(error) }
}

export const listOutcomeStudioTestReferenceHistory = async (req, res, next) => {
  try {
    const result = await outcomeStudioTestReferenceService.listOutcomeStudioTestReferenceHistory({
      referenceKey: req.validatedOutcomeStudioTestReferenceKey,
      ...req.validatedOutcomeStudioTestReferencePagination,
    })
    res.status(200).json(envelope(req, result.items, { page: result.page, pageSize: result.pageSize, total: result.total, totalPages: result.totalPages }))
  } catch (error) { next(error) }
}

export const downloadOutcomeStudioTestReference = async (req, res, next) => {
  try {
    const content = await outcomeStudioTestReferenceService.getOutcomeStudioTestReferenceContent(req.validatedOutcomeStudioTestReferenceKey)
    const name = safeDownloadName(content.originalFileName)
    res.set({
      'Content-Type': content.mimeType,
      'Content-Length': String(content.bytes.length),
      'Content-Disposition': `attachment; filename="${name.fallback}"; filename*=UTF-8''${name.encoded}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    })
    res.status(200).send(content.bytes)
  } catch (error) { next(error) }
}

export const approveOutcomeStudioTestReference = async (req, res, next) => {
  try {
    const data = await outcomeStudioTestReferenceService.approveOutcomeStudioTestReference({
      referenceKey: req.validatedOutcomeStudioTestReferenceKey,
      payload: req.validatedOutcomeStudioTestReferenceApproval,
      request: req,
    })
    res.status(201).json(envelope(req, data))
  } catch (error) { next(error) }
}

export const supersedeOutcomeStudioTestReference = async (req, res, next) => {
  try {
    const data = await outcomeStudioTestReferenceService.supersedeOutcomeStudioTestReference({
      referenceKey: req.validatedOutcomeStudioTestReferenceKey,
      payload: req.validatedOutcomeStudioTestReferenceSupersession,
      request: req,
    })
    res.status(201).json(envelope(req, data))
  } catch (error) { next(error) }
}
