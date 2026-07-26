import { createHash } from 'node:crypto'
import { OUTCOME_STUDIO_EXPORT_FORMATS } from '../constants/runtimeOutcomeStudio.js'
import { resolveOutcomeRendererCapability } from './outcomeRendererCapabilityRegistryService.js'
import { renderProfessionalDocumentCandidate } from './professionalDocumentCandidateRenderer.js'

export const OUTPUT_SERVICE_CONTRACT_VERSION = 'output-service.compatibility-v1'

export const OUTPUT_SERVICE_ERROR_CODES = Object.freeze({
  CAPABILITY_UNSUPPORTED: 'OUTPUT_CAPABILITY_UNSUPPORTED',
  INPUT_INVALID: 'OUTPUT_INPUT_INVALID',
  READY_EVIDENCE_FAILED: 'OUTPUT_READY_EVIDENCE_FAILED',
  RENDER_FAILED: 'OUTPUT_RENDER_FAILED',
  VALIDATION_FAILED: 'OUTPUT_VALIDATION_FAILED',
})

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeKey = (value) => normalizeText(value).toLowerCase()

const createOutputServiceError = ({
  code,
  details = {},
  message,
  reason,
  cause = null,
}) => {
  const err = new Error(message)
  err.name = 'OutputServiceError'
  err.code = code
  err.reason = reason || code
  err.details = {
    reason: err.reason,
    ...details,
    contentIncludedInError: false,
  }
  if (cause) err.cause = cause
  return err
}

export const isOutputServiceError = (err) => err?.name === 'OutputServiceError'

const normalizeFilenamePart = (value, fallback = 'outcome-asset') => {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || fallback
}

const hashBuffer = (buffer) =>
  `sha256:${createHash('sha256').update(buffer).digest('hex')}`

const hashJson = (value) => hashBuffer(Buffer.from(JSON.stringify(value), 'utf8'))

const cloneJsonValue = (value) => JSON.parse(JSON.stringify(value))

const normalizeStringList = (value) => (
  Array.isArray(value) ? value.map(normalizeText).filter(Boolean) : []
)

const normalizeDocumentMetadata = (value = {}) => ({
  title: normalizeText(value.title),
  deliverableType: normalizeText(value.deliverableType),
  outputTypeDisplayKey: normalizeText(value.outputTypeDisplayKey),
  versionNumber: Number(value.versionNumber || 0),
  status: normalizeToken(value.status),
  warnings: normalizeStringList(value.warnings),
  limitations: normalizeStringList(value.limitations),
})

const normalizeSourceBinding = (value = {}) => ({
  assetId: normalizeText(value.assetId),
  assetVersionId: normalizeText(value.assetVersionId),
  versionNumber: Number(value.versionNumber || 0),
})

const normalizeCapabilityBinding = (value = {}) => ({
  outputTypeKey: normalizeKey(value.outputTypeKey),
  outputSchemaKey: normalizeKey(value.outputSchemaKey),
  styleKey: normalizeKey(value.styleKey),
})

const assertDocumentMetadata = (metadata) => {
  if (metadata.versionNumber > 0) return
  throw createOutputServiceError({
    code: OUTPUT_SERVICE_ERROR_CODES.INPUT_INVALID,
    message: 'Output document metadata is incomplete.',
    reason: 'OUTPUT_DOCUMENT_METADATA_INVALID',
    details: { field: 'documentMetadata.versionNumber' },
  })
}

const assertSourceBinding = (sourceBinding) => {
  if (sourceBinding.assetId && sourceBinding.assetVersionId && sourceBinding.versionNumber > 0) return
  throw createOutputServiceError({
    code: OUTPUT_SERVICE_ERROR_CODES.INPUT_INVALID,
    message: 'Output source binding is incomplete.',
    reason: 'OUTPUT_SOURCE_BINDING_INVALID',
  })
}

const resolveOutputDescriptor = ({
  capabilityBinding = {},
  documentMetadata = {},
  format,
} = {}) => {
  const normalizedFormat = normalizeToken(format)
  const binding = normalizeCapabilityBinding(capabilityBinding)
  const metadata = normalizeDocumentMetadata(documentMetadata)
  assertDocumentMetadata(metadata)

  const resolution = resolveOutcomeRendererCapability({
    ...binding,
    format: normalizedFormat,
  })
  if (resolution.status !== 'SUPPORTED') {
    throw createOutputServiceError({
      code: OUTPUT_SERVICE_ERROR_CODES.CAPABILITY_UNSUPPORTED,
      message: 'Output capability is not supported.',
      reason: resolution.reason || 'OUTPUT_CAPABILITY_UNSUPPORTED',
      details: { format: normalizedFormat },
    })
  }

  const formatDefinition = resolution.capability.formats
    .find((entry) => entry.format === normalizedFormat)
  if (!formatDefinition?.mimeType || !formatDefinition?.extension) {
    throw createOutputServiceError({
      code: OUTPUT_SERVICE_ERROR_CODES.CAPABILITY_UNSUPPORTED,
      message: 'Output format metadata is incomplete.',
      reason: 'OUTPUT_FORMAT_METADATA_MISSING',
      details: { format: normalizedFormat },
    })
  }

  const label = normalizeFilenamePart(
    metadata.title || metadata.deliverableType || metadata.outputTypeDisplayKey,
  )
  return {
    binding,
    capability: resolution.capability,
    documentMetadata: metadata,
    extension: formatDefinition.extension,
    filename: `${label}-v${metadata.versionNumber}.${formatDefinition.extension}`,
    format: normalizedFormat,
    mimeType: formatDefinition.mimeType,
  }
}

export const describeOutputDerivative = (input = {}) => {
  const descriptor = resolveOutputDescriptor(input)
  return {
    filename: descriptor.filename,
    format: descriptor.format,
    mimeType: descriptor.mimeType,
  }
}

const normalizeReviewItem = (value) => normalizeText(value)
  .replace(/\s+/g, ' ')
  .toLowerCase()

const getMissingReviewItems = ({ emitted, markdown, values = [] }) => {
  const normalizedMarkdown = normalizeReviewItem(markdown)
  const missing = []
  values.forEach((value) => {
    const text = normalizeText(value)
    const normalized = normalizeReviewItem(text)
    if (!normalized || emitted.has(normalized) || normalizedMarkdown.includes(normalized)) return
    emitted.add(normalized)
    missing.push(text)
  })
  return missing
}

const renderMarkdown = ({ documentMetadata, markdown = '' }) => {
  const source = normalizeText(markdown)
  const emitted = new Set()
  const warnings = getMissingReviewItems({
    emitted,
    markdown: source,
    values: documentMetadata.warnings,
  })
  const limitations = getMissingReviewItems({
    emitted,
    markdown: source,
    values: documentMetadata.limitations,
  })

  return [
    source,
    ...(warnings.length ? [
    '',
    '## Important Review Notes',
    '',
    ...warnings.map((warning) => `- ${warning}`),
  ] : []),
    ...(limitations.length ? [
    '',
    '## Limitations',
    '',
    ...limitations.map((limitation) => `- ${limitation}`),
  ] : []),
  ].join('\n')
}

const renderJson = ({ documentMetadata, structuredContent }) => ({
  title: documentMetadata.title,
  deliverableType: documentMetadata.deliverableType,
  version: documentMetadata.versionNumber,
  status: documentMetadata.status,
  content: cloneJsonValue(structuredContent),
  warnings: [...documentMetadata.warnings],
  limitations: [...documentMetadata.limitations],
})

const stripMarkdownSyntax = (value = '') =>
  normalizeText(value)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '- ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')

const escapeXmlText = (value = '') =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const escapePdfText = (value = '') =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')

const chunkExportTextLines = (value = '', maxLineLength = 92) => {
  const sourceLines = stripMarkdownSyntax(value)
    .split(/\r?\n/)
    .flatMap((line) => {
      const normalized = line.trim()
      if (!normalized) return ['']
      const words = normalized.split(/\s+/)
      const wrapped = []
      let current = ''
      words.forEach((word) => {
        const next = current ? `${current} ${word}` : word
        if (next.length > maxLineLength && current) {
          wrapped.push(current)
          current = word
          return
        }
        current = next
      })
      if (current) wrapped.push(current)
      return wrapped
    })
  return sourceLines.length ? sourceLines : ['']
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return value >>> 0
})

const crc32 = (buffer) => {
  let value = 0xffffffff
  for (const byte of buffer) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

const buildZipArchive = (files = []) => {
  const localParts = []
  const centralParts = []
  let offset = 0

  files.forEach(({ name, content }) => {
    const nameBuffer = Buffer.from(name)
    const contentBuffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content ?? ''), 'utf8')
    const checksum = crc32(contentBuffer)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt16LE(0, 10)
    localHeader.writeUInt16LE(0, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(contentBuffer.length, 18)
    localHeader.writeUInt32LE(contentBuffer.length, 22)
    localHeader.writeUInt16LE(nameBuffer.length, 26)
    localHeader.writeUInt16LE(0, 28)
    localParts.push(localHeader, nameBuffer, contentBuffer)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt16LE(0, 12)
    centralHeader.writeUInt16LE(0, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(contentBuffer.length, 20)
    centralHeader.writeUInt32LE(contentBuffer.length, 24)
    centralHeader.writeUInt16LE(nameBuffer.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, nameBuffer)
    offset += localHeader.length + nameBuffer.length + contentBuffer.length
  })

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, centralDirectory, end])
}

const renderDocx = (markdown) => {
  const paragraphXml = chunkExportTextLines(markdown)
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXmlText(line)}</w:t></w:r></w:p>`)
    .join('')
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphXml}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`
  return buildZipArchive([
    {
      name: '[Content_Types].xml',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    {
      name: '_rels/.rels',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    { name: 'word/document.xml', content: documentXml },
  ])
}

const renderPdf = (markdown) => {
  const lines = chunkExportTextLines(markdown, 88)
  const pages = []
  for (let index = 0; index < lines.length; index += 44) pages.push(lines.slice(index, index + 44))
  const objects = []
  const addObject = (body) => {
    objects.push(body)
    return objects.length
  }
  const catalogRef = addObject('<< /Type /Catalog /Pages 2 0 R >>')
  const pagesRef = addObject('')
  const fontRef = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const pageRefs = []

  pages.forEach((pageLines) => {
    const streamText = [
      'BT',
      '/F1 10 Tf',
      '50 760 Td',
      '14 TL',
      ...pageLines.map((line, index) => `${index === 0 ? '' : 'T* '}(${escapePdfText(line)}) Tj`),
      'ET',
    ].join('\n')
    const streamRef = addObject(`<< /Length ${Buffer.byteLength(streamText)} >>\nstream\n${streamText}\nendstream`)
    const pageRef = addObject(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontRef} 0 R >> >> /Contents ${streamRef} 0 R >>`)
    pageRefs.push(pageRef)
  })
  objects[pagesRef - 1] = `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`
  objects[catalogRef - 1] = '<< /Type /Catalog /Pages 2 0 R >>'

  const parts = ['%PDF-1.4\n']
  const offsets = [0]
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(parts.join('')))
    parts.push(`${index + 1} 0 obj\n${body}\nendobj\n`)
  })
  const xrefOffset = Buffer.byteLength(parts.join(''))
  parts.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`)
  offsets.slice(1).forEach((offset) => parts.push(`${String(offset).padStart(10, '0')} 00000 n \n`))
  parts.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`)
  return { buffer: Buffer.from(parts.join(''), 'utf8'), pageCount: pages.length }
}

const assertRenderedOutput = ({ buffer, format, jsonContent, markdown }) => {
  if (format === OUTCOME_STUDIO_EXPORT_FORMATS.MARKDOWN) {
    if (normalizeText(markdown)) return ['MARKDOWN_NON_EMPTY']
  } else if (format === OUTCOME_STUDIO_EXPORT_FORMATS.JSON) {
    if (jsonContent && typeof jsonContent === 'object' && !Array.isArray(jsonContent)) return ['JSON_OBJECT_VALID']
  } else if (format === OUTCOME_STUDIO_EXPORT_FORMATS.DOCX) {
    if (buffer?.subarray(0, 2).toString('utf8') === 'PK' && buffer.includes(Buffer.from('word/document.xml'))) {
      return ['DOCX_ZIP_SIGNATURE_VALID', 'DOCX_DOCUMENT_ENTRY_PRESENT']
    }
  } else if (format === OUTCOME_STUDIO_EXPORT_FORMATS.PDF) {
    const text = buffer?.toString('utf8') || ''
    if (text.startsWith('%PDF-1.4') && text.endsWith('%%EOF')) {
      return ['PDF_HEADER_VALID', 'PDF_TRAILER_VALID']
    }
  }
  throw createOutputServiceError({
    code: OUTPUT_SERVICE_ERROR_CODES.VALIDATION_FAILED,
    message: 'Rendered output failed compatibility validation.',
    reason: 'OUTPUT_COMPATIBILITY_VALIDATION_FAILED',
    details: { format },
  })
}

const getDeliveryPolicy = (format) => {
  if (format === OUTCOME_STUDIO_EXPORT_FORMATS.JSON) return 'INLINE_JSON'
  if ([OUTCOME_STUDIO_EXPORT_FORMATS.DOCX, OUTCOME_STUDIO_EXPORT_FORMATS.PDF].includes(format)) {
    return 'INLINE_BASE64'
  }
  return 'INLINE_TEXT'
}

export const renderOutputDerivative = async ({
  capabilityBinding = {},
  documentMetadata = {},
  format,
  governedContent = {},
  persistReadyEvidence = null,
  sourceBinding = {},
} = {}) => {
  const descriptor = resolveOutputDescriptor({ capabilityBinding, documentMetadata, format })
  const normalizedSourceBinding = normalizeSourceBinding(sourceBinding)
  assertSourceBinding(normalizedSourceBinding)

  let structuredContent
  try {
    structuredContent = cloneJsonValue(governedContent.structuredContent || {})
  } catch (cause) {
    throw createOutputServiceError({
      code: OUTPUT_SERVICE_ERROR_CODES.INPUT_INVALID,
      message: 'Governed output content is invalid.',
      reason: 'OUTPUT_GOVERNED_CONTENT_INVALID',
      cause,
    })
  }
  const baseMarkdown = normalizeText(governedContent.markdown)
  if (!baseMarkdown) {
    throw createOutputServiceError({
      code: OUTPUT_SERVICE_ERROR_CODES.INPUT_INVALID,
      message: 'Governed output content is unavailable.',
      reason: 'OUTPUT_GOVERNED_CONTENT_MISSING',
    })
  }

  let finalMarkdown
  let jsonContent = null
  let outputBuffer = null
  let pageCount = null
  let rendererValidationChecks = []
  let delivery
  try {
    finalMarkdown = renderMarkdown({
      documentMetadata: descriptor.documentMetadata,
      markdown: baseMarkdown,
    })
    jsonContent = renderJson({
      documentMetadata: descriptor.documentMetadata,
      structuredContent,
    })

    if (descriptor.format === OUTCOME_STUDIO_EXPORT_FORMATS.JSON) {
      outputBuffer = Buffer.from(JSON.stringify(jsonContent), 'utf8')
      delivery = { content: jsonContent }
    } else if (descriptor.format === OUTCOME_STUDIO_EXPORT_FORMATS.DOCX) {
      if (descriptor.capability.capabilityKey === 'outcome-professional-document-dev-test') {
        const professionalDocument = await renderProfessionalDocumentCandidate({
          documentMetadata: {
            title: descriptor.documentMetadata.title,
            deliverableType: descriptor.documentMetadata.deliverableType,
            versionNumber: descriptor.documentMetadata.versionNumber,
            status: descriptor.documentMetadata.status,
          },
          markdown: finalMarkdown,
        })
        outputBuffer = professionalDocument.buffer
        rendererValidationChecks = professionalDocument.validation.checks
      } else {
        outputBuffer = renderDocx(finalMarkdown)
      }
      delivery = { encoding: 'base64', contentBase64: outputBuffer.toString('base64') }
    } else if (descriptor.format === OUTCOME_STUDIO_EXPORT_FORMATS.PDF) {
      const pdf = renderPdf(finalMarkdown)
      outputBuffer = pdf.buffer
      pageCount = pdf.pageCount
      delivery = { encoding: 'base64', contentBase64: outputBuffer.toString('base64') }
    } else {
      outputBuffer = Buffer.from(finalMarkdown, 'utf8')
      delivery = { content: finalMarkdown }
    }
  } catch (cause) {
    if (isOutputServiceError(cause)) throw cause
    throw createOutputServiceError({
      code: OUTPUT_SERVICE_ERROR_CODES.RENDER_FAILED,
      message: 'Output rendering failed.',
      reason: 'OUTPUT_RENDERER_EXECUTION_FAILED',
      details: { format: descriptor.format },
      cause,
    })
  }

  const validationChecks = [...new Set([
    ...assertRenderedOutput({
    buffer: outputBuffer,
    format: descriptor.format,
    jsonContent,
    markdown: finalMarkdown,
    }),
    ...rendererValidationChecks,
  ])]
  const sourceContentChecksum = hashJson({
    documentMetadata: descriptor.documentMetadata,
    governedContent: { markdown: baseMarkdown, structuredContent },
  })
  const outputChecksum = hashBuffer(outputBuffer)
  const evidence = {
    contractVersion: OUTPUT_SERVICE_CONTRACT_VERSION,
    capabilityKey: descriptor.capability.capabilityKey,
    capabilityVersion: descriptor.capability.capabilityVersion,
    engine: { ...descriptor.capability.engine },
    sourceBinding: normalizedSourceBinding,
    sourceContentChecksum,
    derivativeFingerprint: hashJson({
      capabilityKey: descriptor.capability.capabilityKey,
      capabilityVersion: descriptor.capability.capabilityVersion,
      format: descriptor.format,
      sourceBinding: normalizedSourceBinding,
      sourceContentChecksum,
    }),
    format: descriptor.format,
    mimeType: descriptor.mimeType,
    extension: descriptor.extension,
    byteLength: outputBuffer.length,
    outputChecksum,
    ...(pageCount ? { pageCount } : {}),
    validation: { status: 'PASS', checks: validationChecks },
    deliveryPolicy: getDeliveryPolicy(descriptor.format),
    profileReferences: cloneJsonValue(descriptor.capability.profileReferences || {}),
    contentIncludedInEvidence: false,
  }

  if (persistReadyEvidence) {
    try {
      await persistReadyEvidence(evidence)
    } catch (cause) {
      throw createOutputServiceError({
        code: OUTPUT_SERVICE_ERROR_CODES.READY_EVIDENCE_FAILED,
        message: 'Output ready evidence could not be persisted.',
        reason: 'OUTPUT_READY_EVIDENCE_PERSISTENCE_FAILED',
        details: { format: descriptor.format },
        cause,
      })
    }
  }

  return {
    delivery: {
      format: descriptor.format,
      filename: descriptor.filename,
      mimeType: descriptor.mimeType,
      exportAvailable: true,
      ...delivery,
    },
    evidence,
  }
}

export const __testables = Object.freeze({
  assertRenderedOutput,
})
