import PDFDocument from 'pdfkit'
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs'
import {
  parseProfessionalDocumentCandidateInput,
  PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE,
} from './professionalDocumentCandidateRenderer.js'

const FIXED_DOCUMENT_DATE = new Date('2000-01-01T00:00:00.000Z')
const PAGE = Object.freeze({
  width: 612,
  height: 792,
  marginLeft: 54,
  marginRight: 54,
  marginTop: 72,
  marginBottom: 64,
})
const CONTENT_WIDTH = PAGE.width - PAGE.marginLeft - PAGE.marginRight
const CONTENT_BOTTOM = PAGE.height - PAGE.marginBottom
const COLORS = Object.freeze({
  navy: '#17375E',
  blue: '#2B6CB0',
  paleBlue: '#EAF2F8',
  paleGray: '#F4F6F8',
  border: '#CBD5E1',
  body: '#253247',
  muted: '#64748B',
  white: '#FFFFFF',
})

export const PROFESSIONAL_PDF_CANDIDATE_PROFILE = Object.freeze({
  profileKey: 'outcome-professional-pdf-engineering-candidate',
  profileVersion: '0.1.0',
  lifecycleStatus: 'ENGINEERING_CANDIDATE',
  sourceModelVersion: 'outcome-customer-content.v1',
  referenceCandidate: 'COR-005-v1.1-NOT-APPROVED',
  engine: Object.freeze({
    key: 'PDFKIT_IN_PROCESS_ENGINEERING_CANDIDATE',
    version: 'pdfkit@0.19.1',
  }),
  limits: Object.freeze({
    ...PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.limits,
    maxPages: 80,
  }),
})

export const PROFESSIONAL_PDF_CANDIDATE_ERROR_CODES = Object.freeze({
  LIMIT_EXCEEDED: 'PROFESSIONAL_PDF_CANDIDATE_LIMIT_EXCEEDED',
  RENDER_FAILED: 'PROFESSIONAL_PDF_CANDIDATE_RENDER_FAILED',
  VALIDATION_FAILED: 'PROFESSIONAL_PDF_CANDIDATE_VALIDATION_FAILED',
})

const createCandidateError = ({ code, reason, details = {} }) => {
  const error = new Error('The professional PDF engineering candidate could not complete this render.')
  error.name = 'ProfessionalPdfCandidateError'
  error.code = code
  error.reason = reason
  error.details = {
    reason,
    contentIncludedInError: false,
    ...details,
  }
  return error
}

const failLimit = (reason, details = {}) => {
  throw createCandidateError({
    code: PROFESSIONAL_PDF_CANDIDATE_ERROR_CODES.LIMIT_EXCEEDED,
    reason,
    details,
  })
}

const failValidation = (reason, details = {}) => {
  throw createCandidateError({
    code: PROFESSIONAL_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
    reason,
    details,
  })
}

const normalizeInlineText = (value) => String(value ?? '')
  .replace(/\*\*([^*]+)\*\*/g, '$1')
  .replace(/\*([^*]+)\*/g, '$1')
  .replace(/`([^`]+)`/g, '$1')
  .trim()

const setBodyStyle = (doc) => doc
  .font('Helvetica')
  .fontSize(10.5)
  .fillColor(COLORS.body)

const addBodyPage = (doc) => {
  doc.addPage()
  setBodyStyle(doc)
  doc.x = PAGE.marginLeft
  doc.y = PAGE.marginTop
}

const ensureSpace = (doc, requiredHeight) => {
  if (requiredHeight > CONTENT_BOTTOM - PAGE.marginTop) {
    failLimit('PDF_BLOCK_HEIGHT_LIMIT_EXCEEDED', {
      maxBlockHeight: CONTENT_BOTTOM - PAGE.marginTop,
    })
  }
  if (doc.y + requiredHeight > CONTENT_BOTTOM) addBodyPage(doc)
}

const drawCover = (doc, metadata) => {
  doc.addPage()
  doc.rect(0, 0, PAGE.width, 18).fill(COLORS.navy)
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.blue)
    .text('STORYLINEOS OUTCOME STUDIO', PAGE.marginLeft, 74, { characterSpacing: 0.6 })
  doc.font('Helvetica-Bold').fontSize(26).fillColor(COLORS.navy)
    .text(metadata.title, PAGE.marginLeft, 166, { width: CONTENT_WIDTH, lineGap: 4 })
  doc.font('Helvetica').fontSize(13).fillColor(COLORS.blue)
    .text(metadata.deliverableType, PAGE.marginLeft, doc.y + 14, { width: CONTENT_WIDTH })

  const panelY = Math.max(doc.y + 52, 320)
  doc.roundedRect(PAGE.marginLeft, panelY, CONTENT_WIDTH, 104, 3)
    .fillAndStroke(COLORS.paleGray, COLORS.border)
  const rows = [
    ['VERSION', String(metadata.versionNumber)],
    ['DOCUMENT STATUS', metadata.status],
    ['CANDIDATE STATUS', 'ENGINEERING REVIEW ONLY'],
  ]
  rows.forEach(([label, value], index) => {
    const y = panelY + 18 + (index * 27)
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.muted)
      .text(label, PAGE.marginLeft + 18, y, { width: 135 })
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.navy)
      .text(value, PAGE.marginLeft + 165, y - 1, { width: CONTENT_WIDTH - 183 })
  })

  const noticeY = panelY + 144
  doc.rect(PAGE.marginLeft, noticeY, CONTENT_WIDTH, 62).fill(COLORS.paleBlue)
  doc.rect(PAGE.marginLeft, noticeY, 5, 62).fill(COLORS.blue)
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.navy)
    .text('ENGINEERING CANDIDATE - NOT CUSTOMER APPROVED', PAGE.marginLeft + 18, noticeY + 14, {
      width: CONTENT_WIDTH - 36,
    })
  doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.body)
    .text('Product approval, customer activation, accessibility certification, and production readiness are not implied.', PAGE.marginLeft + 18, noticeY + 32, {
      width: CONTENT_WIDTH - 36,
      lineGap: 2,
    })
}

const drawHeading = (doc, block, followingHeight = 28) => {
  const styles = {
    1: { size: 18, color: COLORS.blue, before: 17, after: 7 },
    2: { size: 14, color: COLORS.blue, before: 14, after: 6 },
    3: { size: 11.5, color: COLORS.navy, before: 12, after: 5 },
  }
  const style = styles[block.level] || styles[3]
  const text = normalizeInlineText(block.text)
  doc.font('Helvetica-Bold').fontSize(style.size)
  const textHeight = doc.heightOfString(text, { width: CONTENT_WIDTH, lineGap: 2 })
  ensureSpace(doc, style.before + textHeight + style.after + followingHeight)
  doc.y += style.before
  doc.fillColor(style.color).text(text, PAGE.marginLeft, doc.y, {
    width: CONTENT_WIDTH,
    lineGap: 2,
  })
  doc.y += style.after
}

const drawParagraph = (doc, text) => {
  ensureSpace(doc, 26)
  setBodyStyle(doc).text(normalizeInlineText(text), PAGE.marginLeft, doc.y, {
    width: CONTENT_WIDTH,
    lineGap: 3,
    paragraphGap: 7,
  })
}

const drawListItem = (doc, text, marker) => {
  const normalized = normalizeInlineText(text)
  setBodyStyle(doc)
  const textHeight = doc.heightOfString(normalized, { width: CONTENT_WIDTH - 30, lineGap: 2 })
  ensureSpace(doc, textHeight + 8)
  const startY = doc.y
  doc.font('Helvetica-Bold').fillColor(COLORS.blue)
    .text(marker, PAGE.marginLeft, startY, { width: 20, align: 'right' })
  setBodyStyle(doc).text(normalized, PAGE.marginLeft + 30, startY, {
    width: CONTENT_WIDTH - 30,
    lineGap: 2,
  })
  doc.y = Math.max(doc.y, startY + textHeight) + 5
}

const drawCallout = (doc, text) => {
  const normalized = normalizeInlineText(text)
  doc.font('Helvetica-Oblique').fontSize(10.5)
  const height = doc.heightOfString(normalized, { width: CONTENT_WIDTH - 38, lineGap: 3 }) + 26
  ensureSpace(doc, height + 8)
  const startY = doc.y
  doc.rect(PAGE.marginLeft, startY, CONTENT_WIDTH, height).fill(COLORS.paleBlue)
  doc.rect(PAGE.marginLeft, startY, 5, height).fill(COLORS.blue)
  doc.fillColor(COLORS.body).text(normalized, PAGE.marginLeft + 19, startY + 13, {
    width: CONTENT_WIDTH - 38,
    lineGap: 3,
  })
  doc.y = startY + height + 8
}

const drawCode = (doc, text) => {
  const normalized = String(text ?? '')
  doc.font('Courier').fontSize(8.5)
  const height = doc.heightOfString(normalized || ' ', { width: CONTENT_WIDTH - 28, lineGap: 2 }) + 24
  ensureSpace(doc, height + 8)
  const startY = doc.y
  doc.rect(PAGE.marginLeft, startY, CONTENT_WIDTH, height).fill(COLORS.paleGray)
  doc.fillColor(COLORS.navy).text(normalized || ' ', PAGE.marginLeft + 14, startY + 12, {
    width: CONTENT_WIDTH - 28,
    lineGap: 2,
  })
  doc.y = startY + height + 8
}

const calculateColumnWidths = ({ header, rows }) => {
  const scores = header.map((value, columnIndex) => {
    const longest = rows.reduce(
      (current, row) => Math.max(current, normalizeInlineText(row[columnIndex]).length),
      normalizeInlineText(value).length,
    )
    return Math.max(8, Math.min(52, longest))
  })
  const total = scores.reduce((sum, value) => sum + value, 0)
  const minimum = Math.min(72, Math.floor((CONTENT_WIDTH / header.length) * 0.62))
  const flexible = CONTENT_WIDTH - (minimum * header.length)
  const widths = scores.map((score) => minimum + ((score / total) * flexible))
  widths[widths.length - 1] += CONTENT_WIDTH - widths.reduce((sum, value) => sum + value, 0)
  return widths
}

const measureTableRow = (doc, row, widths, { heading = false } = {}) => {
  doc.font(heading ? 'Helvetica-Bold' : 'Helvetica').fontSize(heading ? 8.5 : 8.25)
  return Math.max(24, ...row.map((value, index) => (
    doc.heightOfString(normalizeInlineText(value), { width: widths[index] - 14, lineGap: 1 }) + 12
  )))
}

const drawTableRow = (doc, row, widths, height, { heading = false, alternate = false } = {}) => {
  const startY = doc.y
  let x = PAGE.marginLeft
  row.forEach((value, index) => {
    const fill = heading ? COLORS.navy : alternate ? COLORS.paleGray : COLORS.white
    doc.rect(x, startY, widths[index], height).fillAndStroke(fill, COLORS.border)
    doc.font(heading ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(heading ? 8.5 : 8.25)
      .fillColor(heading ? COLORS.white : COLORS.body)
      .text(normalizeInlineText(value), x + 7, startY + 6, {
        width: widths[index] - 14,
        height: height - 12,
        lineGap: 1,
      })
    x += widths[index]
  })
  doc.y = startY + height
}

const drawTable = (doc, block) => {
  const widths = calculateColumnWidths(block)
  const headerHeight = measureTableRow(doc, block.header, widths, { heading: true })
  const rowHeights = block.rows.map((row) => measureTableRow(doc, row, widths))
  const maxRowHeight = CONTENT_BOTTOM - PAGE.marginTop - headerHeight
  if (headerHeight > 72 || rowHeights.some((height) => height > maxRowHeight)) {
    failLimit('PDF_TABLE_ROW_HEIGHT_LIMIT_EXCEEDED', { maxRowHeight })
  }

  ensureSpace(doc, headerHeight + Math.min(rowHeights[0] || 0, maxRowHeight) + 8)
  drawTableRow(doc, block.header, widths, headerHeight, { heading: true })
  block.rows.forEach((row, index) => {
    if (doc.y + rowHeights[index] > CONTENT_BOTTOM) {
      addBodyPage(doc)
      drawTableRow(doc, block.header, widths, headerHeight, { heading: true })
    }
    drawTableRow(doc, row, widths, rowHeights[index], { alternate: index % 2 === 1 })
  })
  doc.y += 12
}

const measureMinimumFollowingHeight = (doc, block) => {
  if (!block) return 0
  if (block.type === 'table') {
    const widths = calculateColumnWidths(block)
    const headerHeight = measureTableRow(doc, block.header, widths, { heading: true })
    const firstRowHeight = block.rows.length ? measureTableRow(doc, block.rows[0], widths) : 0
    return headerHeight + firstRowHeight + 8
  }
  if (block.type === 'quote') {
    doc.font('Helvetica-Oblique').fontSize(10.5)
    return doc.heightOfString(normalizeInlineText(block.text), { width: CONTENT_WIDTH - 38, lineGap: 3 }) + 34
  }
  if (block.type === 'code') {
    doc.font('Courier').fontSize(8.5)
    return doc.heightOfString(String(block.text ?? '') || ' ', { width: CONTENT_WIDTH - 28, lineGap: 2 }) + 32
  }
  if (block.type === 'bullet' || block.type === 'number') {
    setBodyStyle(doc)
    return doc.heightOfString(normalizeInlineText(block.text), { width: CONTENT_WIDTH - 30, lineGap: 2 }) + 8
  }
  if (block.type === 'divider') return 20
  if (block.type === 'heading') return 44

  setBodyStyle(doc)
  const paragraphHeight = doc.heightOfString(normalizeInlineText(block.text), {
    width: CONTENT_WIDTH,
    lineGap: 3,
  })
  return Math.min(paragraphHeight + 7, 48)
}

const drawDivider = (doc) => {
  ensureSpace(doc, 20)
  doc.moveTo(PAGE.marginLeft, doc.y + 7)
    .lineTo(PAGE.marginLeft + CONTENT_WIDTH, doc.y + 7)
    .lineWidth(0.7)
    .strokeColor(COLORS.border)
    .stroke()
  doc.y += 20
}

const renderBody = (doc, parsed) => {
  addBodyPage(doc)
  let number = 0
  parsed.blocks.forEach((block, index) => {
    if (block.type === 'heading') {
      drawHeading(doc, block, measureMinimumFollowingHeight(doc, parsed.blocks[index + 1]))
    }
    else if (block.type === 'bullet') drawListItem(doc, block.text, '-')
    else if (block.type === 'number') {
      number += 1
      drawListItem(doc, block.text, `${number}.`)
    } else if (block.type === 'quote') drawCallout(doc, block.text)
    else if (block.type === 'code') drawCode(doc, block.text)
    else if (block.type === 'table') drawTable(doc, block)
    else if (block.type === 'divider') drawDivider(doc)
    else drawParagraph(doc, block.text)
  })
}

const drawPageFurniture = (doc, metadata) => {
  const range = doc.bufferedPageRange()
  if (range.count > PROFESSIONAL_PDF_CANDIDATE_PROFILE.limits.maxPages) {
    failLimit('PDF_PAGE_LIMIT_EXCEEDED', {
      maxPages: PROFESSIONAL_PDF_CANDIDATE_PROFILE.limits.maxPages,
    })
  }

  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index)
    const originalBottomMargin = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    if (index > range.start) {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.muted)
        .text(metadata.deliverableType.toUpperCase(), PAGE.marginLeft, 34, {
          width: CONTENT_WIDTH,
          characterSpacing: 0.4,
          lineBreak: false,
        })
      doc.moveTo(PAGE.marginLeft, 51)
        .lineTo(PAGE.marginLeft + CONTENT_WIDTH, 51)
        .lineWidth(0.6)
        .strokeColor(COLORS.border)
        .stroke()
    }
    doc.moveTo(PAGE.marginLeft, PAGE.height - 44)
      .lineTo(PAGE.marginLeft + CONTENT_WIDTH, PAGE.height - 44)
      .lineWidth(0.6)
      .strokeColor(COLORS.border)
      .stroke()
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
      .text('ENGINEERING CANDIDATE - NOT CUSTOMER APPROVED', PAGE.marginLeft, PAGE.height - 34, {
        width: CONTENT_WIDTH - 50,
        lineBreak: false,
      })
    doc.font('Helvetica-Bold').fontSize(7).fillColor(COLORS.navy)
      .text(`${index - range.start + 1} / ${range.count}`, PAGE.width - PAGE.marginRight - 46, PAGE.height - 34, {
        width: 46,
        align: 'right',
        lineBreak: false,
      })
    doc.page.margins.bottom = originalBottomMargin
  }
  return range.count
}

const renderPdfBuffer = ({ documentMetadata, parsed }) => new Promise((resolve, reject) => {
  const chunks = []
  const doc = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    compress: true,
    displayTitle: true,
    size: 'LETTER',
    margins: {
      top: PAGE.marginTop,
      right: PAGE.marginRight,
      bottom: PAGE.marginBottom,
      left: PAGE.marginLeft,
    },
    info: {
      Title: documentMetadata.title,
      Subject: documentMetadata.deliverableType,
      Author: 'StoryLineOS Output Service Engineering Candidate',
      Creator: 'StoryLineOS Output Service Engineering Candidate',
      Producer: 'StoryLineOS PDF Engineering Candidate',
      CreationDate: FIXED_DOCUMENT_DATE,
      ModDate: FIXED_DOCUMENT_DATE,
    },
  })
  doc.on('data', (chunk) => chunks.push(chunk))
  doc.on('error', reject)
  doc.on('end', () => resolve(Buffer.concat(chunks)))

  try {
    drawCover(doc, documentMetadata)
    renderBody(doc, parsed)
    drawPageFurniture(doc, documentMetadata)
    doc.end()
  } catch (error) {
    reject(error)
  }
})

const FORBIDDEN_PDF_NAMES = new Set([
  'AA',
  'ACROFORM',
  'EMBEDDEDFILE',
  'ENCRYPT',
  'FILESPEC',
  'IMPORTDATA',
  'JAVASCRIPT',
  'JS',
  'LAUNCH',
  'OPENACTION',
  'RICHMEDIA',
  'SUBMITFORM',
  'URI',
  'XFA',
  'GOTOR',
])

const decodePdfName = (value) => String(value ?? '')
  .replace(/#([0-9a-f]{2})/gi, (_match, encoded) => String.fromCharCode(Number.parseInt(encoded, 16)))
  .toUpperCase()

const inspectPdfNames = (buffer) => {
  const source = buffer.toString('latin1').replace(/%[^\r\n]*/g, ' ')
  const names = []
  const pattern = /\/([^\x00\x09\x0a\x0c\x0d ()<>\[\]{}/%]+)/g
  let match
  while ((match = pattern.exec(source)) !== null) names.push(decodePdfName(match[1]))
  const forbiddenName = names.find((name) => FORBIDDEN_PDF_NAMES.has(name))
  if (forbiddenName) failValidation('PDF_ACTIVE_CONTENT_NAME_NOT_ALLOWED', { forbiddenName })
  return names.length
}

const hasObjectEntries = (value) => Boolean(
  value
  && typeof value === 'object'
  && Object.keys(value).length > 0,
)

const inspectOutline = (items = []) => {
  for (const item of items || []) {
    if (item?.url || item?.unsafeUrl) failValidation('PDF_EXTERNAL_OUTLINE_NOT_ALLOWED')
    inspectOutline(item?.items || [])
  }
}

const loadPdf = (buffer) => pdfjs.getDocument({
  data: new Uint8Array(Buffer.from(buffer)),
  disableFontFace: true,
  disableWorker: true,
  enableXfa: false,
  isEvalSupported: false,
  stopAtErrors: true,
  useSystemFonts: false,
  useWorkerFetch: false,
  verbosity: pdfjs.VerbosityLevel.ERRORS,
}).promise

export const validateProfessionalPdfCandidate = async (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) failValidation('PDF_OUTPUT_INVALID')
  if (buffer.length > PROFESSIONAL_PDF_CANDIDATE_PROFILE.limits.maxOutputBytes) {
    failValidation('PDF_OUTPUT_LIMIT_EXCEEDED', {
      maxOutputBytes: PROFESSIONAL_PDF_CANDIDATE_PROFILE.limits.maxOutputBytes,
    })
  }

  const raw = buffer.toString('latin1')
  if (!raw.startsWith('%PDF-')) failValidation('PDF_HEADER_INVALID')
  if (!/\n%%EOF\s*$/.test(raw)) failValidation('PDF_EOF_INVALID')
  if (!/\nstartxref\s+\d+\s+%%EOF\s*$/.test(raw)) failValidation('PDF_STARTXREF_MISSING')
  if (!/(?:\nxref\s|\/Type\s*\/XRef\b)/.test(raw)) failValidation('PDF_XREF_MISSING')
  if (!/(?:\ntrailer\s*<<|\/Type\s*\/XRef\b)/.test(raw)) failValidation('PDF_TRAILER_MISSING')
  const nameCount = inspectPdfNames(buffer)

  let document
  try {
    document = await loadPdf(buffer)
    if (!Number.isSafeInteger(document.numPages) || document.numPages < 1) {
      failValidation('PDF_PAGE_COUNT_INVALID')
    }
    if (document.numPages > PROFESSIONAL_PDF_CANDIDATE_PROFILE.limits.maxPages) {
      failValidation('PDF_PAGE_LIMIT_EXCEEDED', {
        maxPages: PROFESSIONAL_PDF_CANDIDATE_PROFILE.limits.maxPages,
      })
    }

    const [attachments, jsActions, fieldObjects, calculationOrderIds, openAction, hasJSActions, outline] = await Promise.all([
      document.getAttachments(),
      document.getJSActions(),
      document.getFieldObjects(),
      document.getCalculationOrderIds(),
      document.getOpenAction(),
      document.hasJSActions(),
      document.getOutline(),
    ])
    if (hasObjectEntries(attachments)) failValidation('PDF_ATTACHMENTS_NOT_ALLOWED')
    if (hasObjectEntries(jsActions) || hasJSActions) failValidation('PDF_JAVASCRIPT_NOT_ALLOWED')
    if (hasObjectEntries(fieldObjects)) failValidation('PDF_FORM_NOT_ALLOWED')
    if (Array.isArray(calculationOrderIds) && calculationOrderIds.length) {
      failValidation('PDF_FORM_ACTION_NOT_ALLOWED')
    }
    if (openAction) failValidation('PDF_OPEN_ACTION_NOT_ALLOWED')
    if (document.isPureXfa || document.allXfaHtml) failValidation('PDF_XFA_NOT_ALLOWED')
    inspectOutline(outline || [])

    let textPageCount = 0
    let annotationCount = 0
    const extractedPages = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const [pageActions, pageXfa, annotations, textContent] = await Promise.all([
        page.getJSActions(),
        page.getXfa(),
        page.getAnnotations({ intent: 'display' }),
        page.getTextContent(),
      ])
      if (hasObjectEntries(pageActions)) failValidation('PDF_PAGE_ACTION_NOT_ALLOWED', { pageNumber })
      if (pageXfa) failValidation('PDF_PAGE_XFA_NOT_ALLOWED', { pageNumber })
      if (Array.isArray(annotations) && annotations.length) {
        annotationCount += annotations.length
        failValidation('PDF_ANNOTATION_NOT_ALLOWED', { pageNumber, annotationCount: annotations.length })
      }
      const pageText = textContent.items.map((item) => String(item?.str || '')).join(' ').replace(/\s+/g, ' ').trim()
      if (!pageText) failValidation('PDF_BLANK_PAGE_NOT_ALLOWED', { pageNumber })
      textPageCount += 1
      extractedPages.push(pageText)

      const [x1, y1, x2, y2] = page.view
      const width = Math.abs(x2 - x1)
      const height = Math.abs(y2 - y1)
      if (Math.abs(width - PAGE.width) > 0.1 || Math.abs(height - PAGE.height) > 0.1) {
        failValidation('PDF_PAGE_GEOMETRY_INVALID', { pageNumber, width, height })
      }
    }
    const extractedText = extractedPages.join(' ').replace(/\s+/g, ' ').toUpperCase()
    if (!extractedText.includes('ENGINEERING CANDIDATE - NOT CUSTOMER APPROVED')) {
      failValidation('PDF_CANDIDATE_NOTICE_MISSING')
    }

    return Object.freeze({
      status: 'PASSED',
      pageCount: document.numPages,
      textPageCount,
      annotationCount,
      parsedNameCount: nameCount,
      activeContentDetected: false,
      contentIncludedInValidation: false,
    })
  } catch (error) {
    if (error?.name === 'ProfessionalPdfCandidateError') throw error
    throw createCandidateError({
      code: PROFESSIONAL_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      reason: 'PDF_PARSE_FAILED',
    })
  } finally {
    if (document) await document.destroy()
  }
}

export const renderProfessionalPdfCandidate = async ({
  documentMetadata = {},
  markdown = '',
} = {}) => {
  const input = parseProfessionalDocumentCandidateInput({ documentMetadata, markdown })
  const startedAt = Date.now()
  let buffer
  try {
    buffer = await renderPdfBuffer(input)
  } catch (error) {
    if (error?.name === 'ProfessionalDocumentCandidateError' || error?.name === 'ProfessionalPdfCandidateError') {
      throw error
    }
    throw createCandidateError({
      code: PROFESSIONAL_PDF_CANDIDATE_ERROR_CODES.RENDER_FAILED,
      reason: 'PDF_CANDIDATE_RENDER_FAILED',
    })
  }
  const renderTimeMs = Date.now() - startedAt
  if (renderTimeMs > PROFESSIONAL_PDF_CANDIDATE_PROFILE.limits.renderTargetMs) {
    throw createCandidateError({
      code: PROFESSIONAL_PDF_CANDIDATE_ERROR_CODES.RENDER_FAILED,
      reason: 'PDF_CANDIDATE_RENDER_TARGET_EXCEEDED',
      details: { renderTargetMs: PROFESSIONAL_PDF_CANDIDATE_PROFILE.limits.renderTargetMs },
    })
  }

  const validation = await validateProfessionalPdfCandidate(buffer)
  return {
    buffer,
    profile: PROFESSIONAL_PDF_CANDIDATE_PROFILE,
    metrics: Object.freeze({
      sourceBytes: Buffer.byteLength(input.source, 'utf8'),
      outputBytes: buffer.length,
      pageCount: validation.pageCount,
      blockCount: input.parsed.blocks.length,
      headingCount: input.parsed.headings,
      tableCount: input.parsed.tables,
      renderTimeMs,
      contentIncludedInMetrics: false,
    }),
    validation,
  }
}

export const __testables = Object.freeze({
  decodePdfName,
  inspectPdfNames,
})
