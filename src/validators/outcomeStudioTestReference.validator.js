import path from 'path'
import {
  OUTCOME_STUDIO_REFERENCE_FAMILIES,
  OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES,
  OUTCOME_STUDIO_TEST_REFERENCE_FORMAT,
  OUTCOME_STUDIO_TEST_REFERENCE_LIMITS,
} from '../constants/outcomeStudioTestReferences.js'

const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const canonicalBase64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const controlPattern = /[\u0000-\u001f\u007f]/

const hasMalformedUtf16 = (value) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

const validationError = (message, field = 'body') => {
  const error = new Error(message)
  error.status = 422
  error.code = OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES.VALIDATION_FAILED
  error.details = { field }
  return error
}

const assertPlainObject = (value, field = 'body') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validationError(`${field} must be an object.`, field)
}

const assertKeys = (value, allowed, field = 'body') => {
  assertPlainObject(value, field)
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw validationError(`${field}.${key} is not allowed.`, `${field}.${key}`)
  }
}

const boundedText = (value, { field, min = 0, max }) => {
  if (typeof value !== 'string') throw validationError(`${field} must be a string.`, field)
  const normalized = value.trim()
  if (normalized.length < min || normalized.length > max) throw validationError(`${field} must contain ${min} to ${max} characters.`, field)
  if (controlPattern.test(normalized)) throw validationError(`${field} contains prohibited control characters.`, field)
  if (hasMalformedUtf16(normalized)) throw validationError(`${field} contains malformed Unicode.`, field)
  return normalized
}

const expectedRevision = (value) => {
  if (!Number.isInteger(value) || value < 1) throw validationError('body.expectedRevision must be an integer of 1 or greater.', 'body.expectedRevision')
  return value
}

const referenceKey = (value, field = 'params.referenceKey') => {
  if (typeof value !== 'string' || !canonicalUuidPattern.test(value)) throw validationError(`${field} must be a canonical reference UUID.`, field)
  return value
}

const validatePdf = (buffer) => {
  if (buffer.length < 8 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw validationError('Uploaded content is not a supported PDF.', 'body.contentBase64')
  }
  const tail = buffer.subarray(Math.max(0, buffer.length - 1024)).toString('latin1')
  if (!tail.includes('%%EOF')) throw validationError('Uploaded PDF is missing its terminal marker.', 'body.contentBase64')
}

const decodeCanonicalBase64 = (value) => {
  if (typeof value !== 'string' || !value.length || value.length > OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_BASE64_CHARACTERS) {
    throw validationError('body.contentBase64 is missing or exceeds the upload limit.', 'body.contentBase64')
  }
  if (value.length % 4 !== 0 || !canonicalBase64Pattern.test(value)) {
    throw validationError('body.contentBase64 must be canonical base64 without whitespace.', 'body.contentBase64')
  }
  const buffer = Buffer.from(value, 'base64')
  if (!buffer.length || buffer.length > OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_RAW_BYTES || buffer.toString('base64') !== value) {
    throw validationError('body.contentBase64 is invalid or exceeds the raw byte limit.', 'body.contentBase64')
  }
  validatePdf(buffer)
  return buffer
}

const normalizeFileName = (value) => {
  const fileName = boundedText(value, { field: 'body.originalFileName', min: 1, max: OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_FILENAME_LENGTH })
  if (path.posix.basename(fileName) !== fileName || path.win32.basename(fileName) !== fileName) {
    throw validationError('body.originalFileName must be a basename without a path.', 'body.originalFileName')
  }
  if (path.extname(fileName).toLowerCase() !== OUTCOME_STUDIO_TEST_REFERENCE_FORMAT.EXTENSION) {
    throw validationError('body.originalFileName must use the .pdf extension.', 'body.originalFileName')
  }
  return fileName
}

export const validateOutcomeStudioTestReferenceUploadPayload = (body) => {
  assertKeys(body, ['family', 'title', 'purpose', 'originalFileName', 'mimeType', 'contentBase64'])
  if (!OUTCOME_STUDIO_REFERENCE_FAMILIES.includes(body.family)) throw validationError('body.family is not supported.', 'body.family')
  if (body.mimeType !== OUTCOME_STUDIO_TEST_REFERENCE_FORMAT.MIME_TYPE) throw validationError('body.mimeType must be application/pdf.', 'body.mimeType')
  const buffer = decodeCanonicalBase64(body.contentBase64)
  return {
    family: body.family,
    title: boundedText(body.title, { field: 'body.title', min: 1, max: OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_TITLE_LENGTH }),
    purpose: body.purpose === undefined ? '' : boundedText(body.purpose, { field: 'body.purpose', max: OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_PURPOSE_LENGTH }),
    originalFileName: normalizeFileName(body.originalFileName),
    mimeType: body.mimeType,
    extension: OUTCOME_STUDIO_TEST_REFERENCE_FORMAT.EXTENSION,
    buffer,
  }
}

export const validateOutcomeStudioTestReferenceApprovalPayload = (body) => {
  assertKeys(body, ['expectedRevision', 'approverName', 'approverRole', 'rationale'])
  return {
    expectedRevision: expectedRevision(body.expectedRevision),
    approverName: boundedText(body.approverName, { field: 'body.approverName', min: 1, max: OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_ACTOR_NAME_LENGTH }),
    approverRole: boundedText(body.approverRole, { field: 'body.approverRole', min: 1, max: OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_ACTOR_NAME_LENGTH }),
    rationale: boundedText(body.rationale, { field: 'body.rationale', min: 1, max: OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_RATIONALE_LENGTH }),
  }
}

export const validateOutcomeStudioTestReferenceSupersessionPayload = (body) => {
  assertKeys(body, ['expectedRevision', 'replacementReferenceKey', 'reason'])
  return {
    expectedRevision: expectedRevision(body.expectedRevision),
    replacementReferenceKey: referenceKey(body.replacementReferenceKey, 'body.replacementReferenceKey'),
    reason: boundedText(body.reason, { field: 'body.reason', min: 1, max: OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_RATIONALE_LENGTH }),
  }
}

const sendValidationError = (res, req, error) => res.status(422).json({
  error: { code: OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES.VALIDATION_FAILED, message: error.message, details: error.details, requestId: req.requestId },
})

const validationMiddleware = (validator, target) => (req, res, next) => {
  try {
    req[target] = validator(req.body)
    next()
  } catch (error) {
    sendValidationError(res, req, error)
  }
}

export const validateOutcomeStudioTestReferenceUpload = validationMiddleware(validateOutcomeStudioTestReferenceUploadPayload, 'validatedOutcomeStudioTestReferenceUpload')
export const validateOutcomeStudioTestReferenceApproval = validationMiddleware(validateOutcomeStudioTestReferenceApprovalPayload, 'validatedOutcomeStudioTestReferenceApproval')
export const validateOutcomeStudioTestReferenceSupersession = validationMiddleware(validateOutcomeStudioTestReferenceSupersessionPayload, 'validatedOutcomeStudioTestReferenceSupersession')

export const validateOutcomeStudioTestReferenceKey = (req, res, next) => {
  try {
    req.validatedOutcomeStudioTestReferenceKey = referenceKey(req.params.referenceKey)
    next()
  } catch (error) {
    sendValidationError(res, req, error)
  }
}

export const parseOutcomeStudioTestReferencePagination = (query = {}) => {
  if (Object.keys(query).some((key) => !['page', 'pageSize'].includes(key))) throw validationError('Unknown pagination query field.', 'query')
  const parseInteger = (value, fallback, field) => {
    if (value === undefined) return fallback
    if (!/^[1-9]\d*$/.test(String(value))) throw validationError(`${field} must be a positive integer.`, field)
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed)) throw validationError(`${field} must be a safe integer.`, field)
    return parsed
  }
  const page = parseInteger(query.page, 1, 'query.page')
  const pageSize = parseInteger(query.pageSize, 25, 'query.pageSize')
  if (page > OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_PAGE) throw validationError(`query.page cannot exceed ${OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_PAGE}.`, 'query.page')
  if (pageSize > OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_PAGE_SIZE) throw validationError(`query.pageSize cannot exceed ${OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_PAGE_SIZE}.`, 'query.pageSize')
  return { page, pageSize }
}

export const validateOutcomeStudioTestReferencePagination = (req, res, next) => {
  try {
    req.validatedOutcomeStudioTestReferencePagination = parseOutcomeStudioTestReferencePagination(req.query)
    next()
  } catch (error) {
    sendValidationError(res, req, error)
  }
}
