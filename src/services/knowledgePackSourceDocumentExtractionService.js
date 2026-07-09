import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import zlib from 'node:zlib'
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs'
import { OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS } from '../constants/outcomeKnowledgePacks.js'

const moduleRequire = createRequire(import.meta.url)
const PDF_CMAP_URL = `${path.dirname(moduleRequire.resolve('pdfjs-dist/cmaps/78-EUC-H.bcmap'))}${path.sep}`
const PDF_STANDARD_FONT_DATA_URL = `${path.dirname(moduleRequire.resolve('pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'))}${path.sep}`

export const SOURCE_DOCUMENT_IMPORT_LIMITS = Object.freeze({
  maxSourceDocumentBytes: 10_000_000,
  maxTextCharacters: 750_000,
  maxPdfTextPages: 80,
  pdfTextTimeoutMs: 15_000,
})

const MAX_INFLATED_SOURCE_DOCUMENT_BYTES =
  SOURCE_DOCUMENT_IMPORT_LIMITS.maxTextCharacters * 4

export const SOURCE_DOCUMENT_EXTRACTION_ERRORS = Object.freeze({
  EXTRACTION_REQUIRED: 'SOURCE_DOCUMENT_EXTRACTION_REQUIRED',
  EXTRACTION_FAILED: 'SOURCE_DOCUMENT_EXTRACTION_FAILED',
  NO_READABLE_TEXT: 'SOURCE_DOCUMENT_NO_READABLE_TEXT',
  SIZE_LIMIT_EXCEEDED: 'SOURCE_DOCUMENT_SIZE_LIMIT_EXCEEDED',
})

const TEXT_SOURCE_DOCUMENT_FORMATS = new Set([
  OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.JSON,
  OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.MARKDOWN,
  OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.YAML,
])

const BINARY_SOURCE_DOCUMENT_FORMATS = new Set([
  OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.DOCX,
  OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.PDF,
])

const normalizeText = (value) => String(value ?? '').trim()

const normalizeDocumentText = (value) => String(value ?? '')
  .slice(0, SOURCE_DOCUMENT_IMPORT_LIMITS.maxTextCharacters)
  .replace(/\r\n?/g, '\n')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFD]/g, ' ')
  .replace(/[^\S\n]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

const sanitizeInlineText = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')

const hashBuffer = (buffer) =>
  `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`

const hashText = (value) => hashBuffer(Buffer.from(String(value || ''), 'utf8'))

const decodeHtmlEntities = (value) => String(value ?? '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&apos;/gi, "'")
  .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))

const stripXmlToText = (xml) => decodeHtmlEntities(String(xml || '')
  .replace(/<w:tab\s*\/>/gi, ' ')
  .replace(/<\/w:p>/gi, '\n')
  .replace(/<[^>]+>/g, ' '))

const countReadableWords = (value) =>
  (String(value || '').match(/\b[A-Za-z][A-Za-z'-]{2,}\b/g) || []).length

const isReadableText = (value) => {
  const text = normalizeDocumentText(value)
  if (!text) return false
  const sample = text.slice(0, 4000)
  const nonWhitespaceLength = sample.replace(/\s/g, '').length
  if (nonWhitespaceLength < 18) return false

  const asciiLetterCount = (sample.match(/[A-Za-z]/g) || []).length
  const nonAsciiCount = (sample.match(/[^\x00-\x7F]/g) || []).length
  const supportedCharacterCount = (sample.match(/[\p{L}\p{N}\s.,;:!?'"()[\]{}\/%&+@#*=<>_|~-]/gu) || []).length
  const asciiLetterRatio = asciiLetterCount / nonWhitespaceLength
  const nonAsciiRatio = nonAsciiCount / sample.length
  const unsupportedRatio = Math.max(0, sample.length - supportedCharacterCount) / sample.length

  return countReadableWords(sample) >= 4
    && asciiLetterRatio >= 0.25
    && nonAsciiRatio <= 0.12
    && unsupportedRatio <= 0.18
}

const requireReadableText = ({ text, code = SOURCE_DOCUMENT_EXTRACTION_ERRORS.NO_READABLE_TEXT }) => {
  const normalizedText = normalizeDocumentText(text)
  if (!isReadableText(normalizedText)) {
    const err = new Error('Source document did not contain readable deterministic text.')
    err.code = code
    throw err
  }
  return normalizedText
}

const decodeSourceDocumentBuffer = (sourceDocument = {}) => {
  const contentBase64 = normalizeText(sourceDocument.contentBase64).replace(/^data:[^,]+,/i, '')
  if (!contentBase64) {
    const err = new Error('Source document binary content is required for deterministic extraction.')
    err.code = SOURCE_DOCUMENT_EXTRACTION_ERRORS.EXTRACTION_REQUIRED
    throw err
  }

  let buffer
  try {
    buffer = Buffer.from(contentBase64, 'base64')
  } catch {
    buffer = Buffer.alloc(0)
  }

  if (!buffer.length || buffer.toString('base64').replace(/=+$/u, '') !== contentBase64.replace(/[\s=]+$/gu, '').replace(/\s+/gu, '')) {
    const err = new Error('Source document binary content could not be decoded.')
    err.code = SOURCE_DOCUMENT_EXTRACTION_ERRORS.EXTRACTION_FAILED
    throw err
  }

  if (buffer.length > SOURCE_DOCUMENT_IMPORT_LIMITS.maxSourceDocumentBytes) {
    const err = new Error('Source document exceeds the import size limit.')
    err.code = SOURCE_DOCUMENT_EXTRACTION_ERRORS.SIZE_LIMIT_EXCEEDED
    throw err
  }

  return buffer
}

const isInflateOutputLimitError = (err) =>
  err instanceof RangeError
  || err?.code === 'ERR_BUFFER_TOO_LARGE'
  || /maxOutputLength|larger than|too large/i.test(String(err?.message || ''))

const createInflateLimitError = () => {
  const err = new Error('Source document compressed content exceeded the deterministic extraction limit.')
  err.code = SOURCE_DOCUMENT_EXTRACTION_ERRORS.EXTRACTION_FAILED
  return err
}

const inflateRawBounded = (compressedData) => {
  try {
    return zlib.inflateRawSync(compressedData, {
      maxOutputLength: MAX_INFLATED_SOURCE_DOCUMENT_BYTES,
    })
  } catch (err) {
    if (isInflateOutputLimitError(err)) throw createInflateLimitError()
    throw err
  }
}

const inflateBounded = (compressedData) => {
  try {
    return zlib.inflateSync(compressedData, {
      maxOutputLength: MAX_INFLATED_SOURCE_DOCUMENT_BYTES,
    })
  } catch (err) {
    if (isInflateOutputLimitError(err)) throw createInflateLimitError()
    throw err
  }
}

const inflateZipEntryData = ({ compressedData, compressionMethod }) => {
  if (compressionMethod === 0) {
    if (compressedData.length > MAX_INFLATED_SOURCE_DOCUMENT_BYTES) {
      throw createInflateLimitError()
    }
    return compressedData
  }
  if (compressionMethod === 8) return inflateRawBounded(compressedData)
  return Buffer.alloc(0)
}

const readZipEntryFromCentralDirectory = (buffer, targetFileName) => {
  let offset = 0

  while (offset + 46 < buffer.length) {
    const signature = buffer.readUInt32LE(offset)
    if (signature !== 0x02014b50) {
      offset += 1
      continue
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const fileNameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const fileNameStart = offset + 46
    const fileNameEnd = fileNameStart + fileNameLength
    const nextOffset = fileNameEnd + extraLength + commentLength

    if (fileNameEnd > buffer.length || nextOffset > buffer.length) {
      offset = Math.max(offset + 4, nextOffset)
      continue
    }

    const fileName = buffer.slice(fileNameStart, fileNameEnd).toString('utf8')
    if (fileName !== targetFileName) {
      offset = nextOffset
      continue
    }

    if (
      compressedSize === 0
      || compressedSize > SOURCE_DOCUMENT_IMPORT_LIMITS.maxSourceDocumentBytes
      || localHeaderOffset + 30 > buffer.length
      || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50
    ) return null

    const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > buffer.length) return null

    const compressedData = buffer.slice(dataStart, dataEnd)
    const data = inflateZipEntryData({ compressedData, compressionMethod })
    return { fileName, data }
  }

  return null
}

const hasCentralDirectory = (buffer) => {
  let offset = 0
  while (offset + 46 < buffer.length) {
    if (buffer.readUInt32LE(offset) === 0x02014b50) return true
    offset += 1
  }
  return false
}

const readZipEntryFromLocalHeaders = (buffer, targetFileName) => {
  let offset = 0

  while (offset + 30 < buffer.length) {
    const signature = buffer.readUInt32LE(offset)
    if (signature !== 0x04034b50) {
      offset += 1
      continue
    }

    const compressionMethod = buffer.readUInt16LE(offset + 8)
    const compressedSize = buffer.readUInt32LE(offset + 18)
    const fileNameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const fileNameStart = offset + 30
    const fileNameEnd = fileNameStart + fileNameLength
    const dataStart = fileNameEnd + extraLength
    const dataEnd = dataStart + compressedSize
    if (fileNameEnd > buffer.length || dataEnd > buffer.length) {
      offset += 4
      continue
    }

    const fileName = buffer.slice(fileNameStart, fileNameEnd).toString('utf8')
    if (fileName !== targetFileName) {
      offset = Math.max(offset + 4, dataEnd)
      continue
    }

    if (
      compressedSize === 0
      || compressedSize > SOURCE_DOCUMENT_IMPORT_LIMITS.maxSourceDocumentBytes
    ) return null

    const compressedData = buffer.slice(dataStart, dataEnd)
    const data = inflateZipEntryData({ compressedData, compressionMethod })
    return { fileName, data }
  }

  return null
}

const readZipEntry = (buffer, targetFileName) => {
  const centralDirectoryEntry = readZipEntryFromCentralDirectory(buffer, targetFileName)
  if (centralDirectoryEntry || hasCentralDirectory(buffer)) return centralDirectoryEntry
  return readZipEntryFromLocalHeaders(buffer, targetFileName)
}

const extractDocxText = (buffer) => {
  const documentEntry = readZipEntry(buffer, 'word/document.xml')
  if (!documentEntry?.data?.length) return ''
  return normalizeDocumentText(stripXmlToText(documentEntry.data.toString('utf8')))
}

const loadPdfDocument = (buffer, options = {}) => pdfjs.getDocument({
  data: new Uint8Array(buffer),
  cMapPacked: true,
  cMapUrl: PDF_CMAP_URL,
  disableFontFace: true,
  disableWorker: true,
  isEvalSupported: false,
  standardFontDataUrl: PDF_STANDARD_FONT_DATA_URL,
  useWorkerFetch: false,
  verbosity: pdfjs.VerbosityLevel.ERRORS,
  ...options,
}).promise

const withTimeout = async ({ promise, timeoutMs, timeoutMessage, onTimeout }) => {
  let timeoutId
  let timedOut = false
  const timeoutPromise = new Promise((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true
      reject(new Error(timeoutMessage))
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timeoutId)
    if (timedOut && typeof onTimeout === 'function') await onTimeout()
  }
}

const extractPdfJsTextWithoutTimeout = async (buffer, documentRef = {}) => {
  const document = await loadPdfDocument(buffer)
  documentRef.current = document
  const pageTexts = []
  const pageCount = Number(document?.numPages || 0)
  const maxPages = Math.min(pageCount, SOURCE_DOCUMENT_IMPORT_LIMITS.maxPdfTextPages)

  try {
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const textContent = await page.getTextContent({
        disableCombineTextItems: false,
        normalizeWhitespace: true,
      })
      const lines = []
      let currentLine = ''
      let currentY = null

      for (const item of textContent.items || []) {
        const text = String(item?.str || '').trim()
        if (!text) continue

        const itemY = Array.isArray(item.transform)
          ? Math.round(Number(item.transform[5] || 0))
          : null
        const startsNewLine = currentY !== null
          && itemY !== null
          && Math.abs(itemY - currentY) > 2

        if (startsNewLine && currentLine) {
          lines.push(currentLine)
          currentLine = text
        } else {
          currentLine = currentLine ? `${currentLine} ${text}` : text
        }

        if (itemY !== null) currentY = itemY
      }

      if (currentLine) lines.push(currentLine)
      pageTexts.push(lines.join('\n'))
    }
  } finally {
    documentRef.current = null
    await document.destroy?.()
  }

  return normalizeDocumentText(pageTexts.filter(Boolean).join('\n'))
}

const extractPdfJsText = async (buffer) => {
  const documentRef = { current: null }
  return withTimeout({
    promise: extractPdfJsTextWithoutTimeout(buffer, documentRef),
    timeoutMs: SOURCE_DOCUMENT_IMPORT_LIMITS.pdfTextTimeoutMs,
    timeoutMessage: 'PDF_TEXT_EXTRACTION_TIMEOUT',
    onTimeout: async () => {
      await documentRef.current?.destroy?.()
    },
  })
}

const decodePdfLiteralString = (value) => String(value || '')
  .replace(/\\n/g, '\n')
  .replace(/\\r/g, '\r')
  .replace(/\\t/g, '\t')
  .replace(/\\b/g, '\b')
  .replace(/\\f/g, '\f')
  .replace(/\\([()\\])/g, '$1')
  .replace(/\\([0-7]{1,3})/g, (_match, octal) => String.fromCharCode(parseInt(octal, 8)))

const decodePdfHexString = (value) => {
  const normalizedHex = String(value || '').replace(/[^0-9a-f]/gi, '')
  if (!normalizedHex) return ''
  const paddedHex = normalizedHex.length % 2 === 0 ? normalizedHex : `${normalizedHex}0`
  const bytes = []
  for (let index = 0; index < paddedHex.length; index += 2) {
    bytes.push(parseInt(paddedHex.slice(index, index + 2), 16))
  }
  const buffer = Buffer.from(bytes.filter((byte) => Number.isFinite(byte)))
  const utf16Text = buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff
    ? buffer.toString('utf16le')
    : ''
  return sanitizeInlineText(utf16Text || buffer.toString('utf8') || buffer.toString('latin1'))
}

const extractPdfOperatorText = (value) => {
  const source = String(value || '')
  const literals = Array.from(source.matchAll(/\((?:\\.|[^\\)]){2,}\)\s*(?:Tj|'|"|TJ)/g))
    .map((match) => decodePdfLiteralString(match[0].replace(/\)\s*(?:Tj|'|"|TJ).*$/s, '').replace(/^\(/, '')))
  const arrayLiterals = Array.from(source.matchAll(/\[((?:.|\n|\r)*?)\]\s*TJ/g))
    .flatMap((match) => Array.from(String(match[1] || '').matchAll(/\((?:\\.|[^\\)]){2,}\)|<([0-9a-fA-F\s]+)>/g))
      .map((tokenMatch) => {
        const token = tokenMatch[0]
        return token.startsWith('<')
          ? decodePdfHexString(token)
          : decodePdfLiteralString(token.slice(1, -1))
      }))
  const hexStrings = Array.from(source.matchAll(/<([0-9a-fA-F\s]{8,})>\s*Tj/g))
    .map((match) => decodePdfHexString(match[1]))

  return sanitizeInlineText([...literals, ...arrayLiterals, ...hexStrings].filter(Boolean).join(' '))
}

const extractPdfOperatorFallbackText = (buffer) => {
  const rawText = buffer.toString('latin1')
  const rawDocumentText = extractPdfOperatorText(rawText)
  const extractedParts = []
  const streamPattern = /(<<[\s\S]{0,1200}?>>)\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g

  for (const match of rawText.matchAll(streamPattern)) {
    const descriptor = match[1] || ''
    const streamBytes = Buffer.from(match[2] || '', 'binary')
    let streamText = ''

    if (/\/FlateDecode\b/i.test(descriptor)) {
      try {
        streamText = inflateBounded(streamBytes).toString('latin1')
      } catch (err) {
        if (err?.code === SOURCE_DOCUMENT_EXTRACTION_ERRORS.EXTRACTION_FAILED) throw err
        try {
          streamText = inflateRawBounded(streamBytes).toString('latin1')
        } catch (rawErr) {
          if (rawErr?.code === SOURCE_DOCUMENT_EXTRACTION_ERRORS.EXTRACTION_FAILED) throw rawErr
          streamText = ''
        }
      }
    } else {
      streamText = streamBytes.toString('latin1')
    }

    if (streamText) extractedParts.push(extractPdfOperatorText(streamText))
  }

  return normalizeDocumentText((extractedParts.length > 0 ? extractedParts : [rawDocumentText])
    .filter(Boolean)
    .join(' '))
}

const extractPdfText = async (buffer) => {
  try {
    const parsedText = await extractPdfJsText(buffer)
    if (isReadableText(parsedText)) {
      return {
        text: normalizeDocumentText(parsedText),
        extractionMethod: 'PDF_TEXT_LAYER',
      }
    }
  } catch {
    // Fall back to deterministic PDF operator extraction for simple legacy PDFs.
  }

  const fallbackText = extractPdfOperatorFallbackText(buffer)
  if (isReadableText(fallbackText)) {
    return {
      text: normalizeDocumentText(fallbackText),
      extractionMethod: 'PDF_OPERATOR_TEXT',
    }
  }

  const err = new Error('PDF source document did not contain readable deterministic text.')
  err.code = SOURCE_DOCUMENT_EXTRACTION_ERRORS.NO_READABLE_TEXT
  throw err
}

export const extractKnowledgePackSourceDocumentText = async ({
  contentFormat,
  sourceDocument = {},
  extractedText,
} = {}) => {
  if (TEXT_SOURCE_DOCUMENT_FORMATS.has(contentFormat)) {
    const text = normalizeDocumentText(extractedText)
    if (!text) {
      const err = new Error('Extracted source text is required for text source imports.')
      err.code = SOURCE_DOCUMENT_EXTRACTION_ERRORS.EXTRACTION_REQUIRED
      throw err
    }
    return {
      text,
      sourceHash: hashText(text),
      parserStatus: 'TEXT_CAPTURED',
      extractionMode: 'DETERMINISTIC_TEXT',
      extractionMethod: 'CLIENT_TEXT',
      extractionAdapter: 'knowledge-pack-text-import-v1',
      sourceSizeBytes: Buffer.byteLength(String(extractedText || ''), 'utf8'),
    }
  }

  if (!BINARY_SOURCE_DOCUMENT_FORMATS.has(contentFormat)) {
    const err = new Error('Source document format is not supported for deterministic extraction.')
    err.code = SOURCE_DOCUMENT_EXTRACTION_ERRORS.EXTRACTION_FAILED
    throw err
  }

  const buffer = decodeSourceDocumentBuffer(sourceDocument)
  const sourceHash = hashBuffer(buffer)

  if (contentFormat === OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.DOCX) {
    const text = requireReadableText({ text: extractDocxText(buffer) })
    return {
      text,
      sourceHash,
      parserStatus: 'TEXT_CAPTURED',
      extractionMode: 'DETERMINISTIC_DOCX',
      extractionMethod: 'DOCX_XML_TEXT',
      extractionAdapter: 'knowledge-pack-docx-text-extraction-v1',
      sourceSizeBytes: buffer.length,
    }
  }

  if (contentFormat === OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.PDF) {
    const extraction = await extractPdfText(buffer)
    return {
      text: extraction.text,
      sourceHash,
      parserStatus: 'TEXT_CAPTURED',
      extractionMode: 'DETERMINISTIC_PDF',
      extractionMethod: extraction.extractionMethod,
      extractionAdapter: 'knowledge-pack-pdf-text-extraction-v1',
      sourceSizeBytes: buffer.length,
    }
  }

  const err = new Error('Source document format is not supported for deterministic extraction.')
  err.code = SOURCE_DOCUMENT_EXTRACTION_ERRORS.EXTRACTION_FAILED
  throw err
}
