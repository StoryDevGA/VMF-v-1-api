import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx'
import JSZip from 'jszip'
import logger from '../config/logger.js'

export const PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE = Object.freeze({
  profileKey: 'outcome-professional-document-engineering-candidate',
  profileVersion: '0.1.0',
  lifecycleStatus: 'ENGINEERING_CANDIDATE',
  sourceModelVersion: 'outcome-customer-content.v1',
  referenceCandidate: 'COR-005-v1.1-NOT-APPROVED',
  engine: Object.freeze({
    key: 'DOCX_JS_IN_PROCESS_ENGINEERING_CANDIDATE',
    version: 'docx@9.7.1',
  }),
  limits: Object.freeze({
    maxSourceBytes: 262_144,
    maxTitleBytes: 256,
    maxDeliverableTypeBytes: 128,
    maxStatusBytes: 64,
    maxVersionNumber: 9_999,
    maxHeadings: 80,
    maxBlocks: 600,
    maxTables: 24,
    maxRowsPerTable: 100,
    maxColumnsPerTable: 12,
    maxCellBytes: 4_096,
    maxOutputBytes: 8_388_608,
    maxExpandedBytes: 16_777_216,
    maxPackageEntries: 200,
    renderTargetMs: 5_000,
  }),
})

export const PROFESSIONAL_DOCUMENT_CANDIDATE_ERROR_CODES = Object.freeze({
  INPUT_INVALID: 'PROFESSIONAL_DOCUMENT_CANDIDATE_INPUT_INVALID',
  INPUT_UNSAFE: 'PROFESSIONAL_DOCUMENT_CANDIDATE_INPUT_UNSAFE',
  LIMIT_EXCEEDED: 'PROFESSIONAL_DOCUMENT_CANDIDATE_LIMIT_EXCEEDED',
  RENDER_FAILED: 'PROFESSIONAL_DOCUMENT_CANDIDATE_RENDER_FAILED',
  VALIDATION_FAILED: 'PROFESSIONAL_DOCUMENT_CANDIDATE_VALIDATION_FAILED',
})

const FIXED_PACKAGE_DATE = new Date('2000-01-01T00:00:00.000Z')
const BODY_WIDTH_DXA = 9_360
const COLORS = Object.freeze({
  navy: '17375E',
  blue: '2B6CB0',
  paleBlue: 'EAF2F8',
  paleGray: 'F4F6F8',
  border: 'CBD5E1',
  body: '253247',
  muted: '64748B',
  white: 'FFFFFF',
})

const normalizeText = (value) => String(value ?? '').replace(/\r\n?/g, '\n').trim()
const utf8Length = (value) => Buffer.byteLength(String(value ?? ''), 'utf8')

const createCandidateError = ({ code, reason, details = {} }) => {
  const error = new Error('The professional document engineering candidate could not complete this render.')
  error.name = 'ProfessionalDocumentCandidateError'
  error.code = code
  error.reason = reason
  error.details = {
    reason,
    contentIncludedInError: false,
    ...details,
  }
  return error
}

const failInput = (reason, details = {}) => {
  throw createCandidateError({
    code: PROFESSIONAL_DOCUMENT_CANDIDATE_ERROR_CODES.INPUT_INVALID,
    reason,
    details,
  })
}

const failUnsafe = (reason) => {
  throw createCandidateError({
    code: PROFESSIONAL_DOCUMENT_CANDIDATE_ERROR_CODES.INPUT_UNSAFE,
    reason,
  })
}

const failLimit = (reason, details = {}) => {
  throw createCandidateError({
    code: PROFESSIONAL_DOCUMENT_CANDIDATE_ERROR_CODES.LIMIT_EXCEEDED,
    reason,
    details,
  })
}

const failValidation = (reason, details = {}) => {
  throw createCandidateError({
    code: PROFESSIONAL_DOCUMENT_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
    reason,
    details,
  })
}

const decodeSecurityText = (value) => {
  let decoded = String(value ?? '')
    .replace(/&#x([0-9a-f]+);?/gi, (match, value) => {
      const codePoint = Number.parseInt(value, 16)
      return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match
    })
    .replace(/&#([0-9]+);?/g, (match, value) => {
      const codePoint = Number.parseInt(value, 10)
      return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match
    })
    .replace(/&colon;/gi, ':')
    .replace(/&sol;/gi, '/')
    .replace(/&bsol;/gi, '\\')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '')
  for (let index = 0; index < 3; index += 1) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      break
    }
  }
  return decoded.toLowerCase().replace(/\s+/g, '')
}

const assertSafeRenderedText = (value) => {
  if (/<\/?[a-z][^>]*>/i.test(value) || /<!doctype|<!entity/i.test(value)) {
    failUnsafe('RAW_HTML_NOT_ALLOWED')
  }
  if (/!\[[^\]]*]\s*\([^)]*\)/m.test(value)) failUnsafe('MARKDOWN_IMAGE_NOT_ALLOWED')
  if (/\[[^\]]+]\s*\([^)]*\)/m.test(value)) failUnsafe('MARKDOWN_LINK_NOT_ALLOWED')
  if (/\\\\[^\s]+|(?:^|\s)[a-z]:[\\/]/im.test(value)) failUnsafe('FILE_PATH_NOT_ALLOWED')

  const securityText = decodeSecurityText(value)
  if (/(?:https?|ftp|file|data|javascript|vbscript|mailto|tel|sms|cid|blob|about):/.test(securityText)) {
    failUnsafe('URI_SCHEME_NOT_ALLOWED')
  }
  if (/(?:^|[^:])\/\/[a-z0-9]/.test(securityText)) failUnsafe('NETWORK_PATH_NOT_ALLOWED')
}

const ALLOWED_METADATA_FIELDS = new Set(['title', 'deliverableType', 'versionNumber', 'status'])

const normalizeDocumentMetadata = (documentMetadata) => {
  if (!documentMetadata
    || typeof documentMetadata !== 'object'
    || Array.isArray(documentMetadata)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(documentMetadata))) {
    failInput('DOCUMENT_METADATA_INVALID')
  }
  if (Object.keys(documentMetadata).some((key) => !ALLOWED_METADATA_FIELDS.has(key))) {
    failInput('DOCUMENT_METADATA_FIELD_UNSUPPORTED')
  }

  const limits = PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.limits
  const normalized = {
    title: normalizeText(documentMetadata.title),
    deliverableType: normalizeText(documentMetadata.deliverableType) || 'Professional Document',
    versionNumber: Number(documentMetadata.versionNumber),
    status: (normalizeText(documentMetadata.status) || 'DRAFT').toUpperCase(),
  }
  if (!normalized.title
    || !Number.isSafeInteger(normalized.versionNumber)
    || normalized.versionNumber < 1
    || normalized.versionNumber > limits.maxVersionNumber) {
    failInput('DOCUMENT_METADATA_INVALID')
  }

  const boundedFields = [
    ['title', normalized.title, limits.maxTitleBytes],
    ['deliverableType', normalized.deliverableType, limits.maxDeliverableTypeBytes],
    ['status', normalized.status, limits.maxStatusBytes],
  ]
  boundedFields.forEach(([field, value, maxBytes]) => {
    if (utf8Length(value) > maxBytes) failLimit('METADATA_FIELD_LIMIT_EXCEEDED', { field, maxBytes })
    assertSafeRenderedText(value)
  })
  return Object.freeze(normalized)
}

const splitTableRow = (line) => {
  const trimmed = String(line ?? '').trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

const isTableSeparator = (line) => {
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

const isStructuralLine = (lines, index) => {
  const line = lines[index] || ''
  const next = lines[index + 1] || ''
  return /^#{1,6}\s+/.test(line)
    || /^\s*[-*+]\s+/.test(line)
    || /^\s*\d+[.)]\s+/.test(line)
    || /^\s*>\s?/.test(line)
    || /^\s*```/.test(line)
    || /^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)
    || (line.includes('|') && isTableSeparator(next))
}

const parseMarkdown = ({ markdown, title }) => {
  const limits = PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.limits
  const lines = markdown.split('\n')
  const blocks = []
  let headings = 0
  let tables = 0
  let index = 0

  const pushBlock = (block) => {
    blocks.push(block)
    if (blocks.length > limits.maxBlocks) failLimit('BLOCK_LIMIT_EXCEEDED', { maxBlocks: limits.maxBlocks })
  }

  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line) {
      index += 1
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      headings += 1
      if (headings > limits.maxHeadings) failLimit('HEADING_LIMIT_EXCEEDED', { maxHeadings: limits.maxHeadings })
      const headingText = headingMatch[2].trim()
      if (!(blocks.length === 0 && headingMatch[1].length === 1 && headingText.toLowerCase() === title.toLowerCase())) {
        pushBlock({ type: 'heading', level: Math.min(headingMatch[1].length, 3), text: headingText })
      }
      index += 1
      continue
    }

    if (line.includes('|') && isTableSeparator(lines[index + 1] || '')) {
      const header = splitTableRow(lines[index])
      const separator = splitTableRow(lines[index + 1])
      if (header.length !== separator.length || header.some((cell) => !cell)) failInput('TABLE_STRUCTURE_INVALID')
      if (header.length > limits.maxColumnsPerTable) {
        failLimit('TABLE_COLUMN_LIMIT_EXCEEDED', { maxColumns: limits.maxColumnsPerTable })
      }
      const rows = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        const row = splitTableRow(lines[index])
        if (row.length !== header.length) failInput('TABLE_STRUCTURE_INVALID')
        if (row.some((cell) => utf8Length(cell) > limits.maxCellBytes)) {
          failLimit('TABLE_CELL_LIMIT_EXCEEDED', { maxCellBytes: limits.maxCellBytes })
        }
        rows.push(row)
        if (rows.length > limits.maxRowsPerTable) {
          failLimit('TABLE_ROW_LIMIT_EXCEEDED', { maxRows: limits.maxRowsPerTable })
        }
        index += 1
      }
      if (header.some((cell) => utf8Length(cell) > limits.maxCellBytes)) {
        failLimit('TABLE_CELL_LIMIT_EXCEEDED', { maxCellBytes: limits.maxCellBytes })
      }
      tables += 1
      if (tables > limits.maxTables) failLimit('TABLE_LIMIT_EXCEEDED', { maxTables: limits.maxTables })
      pushBlock({ type: 'table', header, rows })
      continue
    }

    if (/^\s*```/.test(line)) {
      const codeLines = []
      index += 1
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index >= lines.length) failInput('CODE_BLOCK_UNCLOSED')
      index += 1
      pushBlock({ type: 'code', text: codeLines.join('\n') })
      continue
    }

    const bulletMatch = line.match(/^\s*[-*+]\s+(.+)$/)
    if (bulletMatch) {
      pushBlock({ type: 'bullet', text: bulletMatch[1].trim() })
      index += 1
      continue
    }

    const numberedMatch = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (numberedMatch) {
      pushBlock({ type: 'number', text: numberedMatch[1].trim() })
      index += 1
      continue
    }

    const quoteMatch = line.match(/^\s*>\s?(.*)$/)
    if (quoteMatch) {
      const quoteLines = [quoteMatch[1].trim()]
      index += 1
      while (index < lines.length) {
        const continuation = lines[index].trim().match(/^>\s?(.*)$/)
        if (!continuation) break
        quoteLines.push(continuation[1].trim())
        index += 1
      }
      pushBlock({ type: 'quote', text: quoteLines.join(' ') })
      continue
    }

    if (/^(?:---+|___+|\*\*\*+)$/.test(line)) {
      pushBlock({ type: 'divider' })
      index += 1
      continue
    }

    const paragraphLines = [line]
    index += 1
    while (index < lines.length && lines[index].trim() && !isStructuralLine(lines, index)) {
      paragraphLines.push(lines[index].trim())
      index += 1
    }
    pushBlock({ type: 'paragraph', text: paragraphLines.join(' ') })
  }

  if (blocks.length === 0) failInput('DOCUMENT_BODY_MISSING')
  return { blocks, headings, tables }
}

export const parseProfessionalDocumentCandidateInput = ({
  documentMetadata = {},
  markdown = '',
} = {}) => {
  const normalizedMetadata = normalizeDocumentMetadata(documentMetadata)
  const source = normalizeText(markdown)
  if (!source) failInput('DOCUMENT_SOURCE_MISSING')
  if (utf8Length(source) > PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.limits.maxSourceBytes) {
    failLimit('SOURCE_SIZE_LIMIT_EXCEEDED', {
      maxSourceBytes: PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.limits.maxSourceBytes,
    })
  }
  assertSafeRenderedText(source)

  return Object.freeze({
    documentMetadata: normalizedMetadata,
    source,
    parsed: parseMarkdown({ markdown: source, title: normalizedMetadata.title }),
  })
}

const inlineRuns = (value, overrides = {}) => {
  const source = String(value ?? '')
  const matches = source.match(/\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|[^*`]+|[*`]/g) || []
  return matches.map((part) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return new TextRun({ text: part.slice(2, -2), bold: true, ...overrides })
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return new TextRun({ text: part.slice(1, -1), italics: true, ...overrides })
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return new TextRun({ text: part.slice(1, -1), font: 'Courier New', color: COLORS.navy, ...overrides })
    }
    return new TextRun({ text: part, ...overrides })
  })
}

const makeTable = ({ header, rows }) => {
  const columnScores = header.map((heading, columnIndex) => {
    const longestCell = rows.reduce(
      (longest, row) => Math.max(longest, String(row[columnIndex] || '').length),
      String(heading || '').length,
    )
    return Math.max(8, Math.min(48, longestCell))
  })
  const scoreTotal = columnScores.reduce((total, score) => total + score, 0)
  const minimumWidth = Math.min(900, Math.floor((BODY_WIDTH_DXA / header.length) * 0.7))
  const flexibleWidth = BODY_WIDTH_DXA - (minimumWidth * header.length)
  const columnWidths = columnScores.map((score) => minimumWidth + Math.floor((score / scoreTotal) * flexibleWidth))
  columnWidths[columnWidths.length - 1] += BODY_WIDTH_DXA - columnWidths.reduce((total, width) => total + width, 0)
  const borders = {
    top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
    left: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
    right: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
    insideVertical: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
  }
  const makeCell = (text, columnIndex, { heading = false, alternate = false } = {}) => new TableCell({
    width: { size: columnWidths[columnIndex], type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 110, bottom: 110, left: 130, right: 130 },
    shading: {
      type: ShadingType.CLEAR,
      fill: heading ? COLORS.navy : alternate ? COLORS.paleGray : COLORS.white,
      color: 'auto',
    },
    children: [new Paragraph({
      alignment: !heading && /^(?:GBP\s*)?[\d(][\d,.%()\s-]*(?:years?|months?)?$/i.test(text)
        ? AlignmentType.RIGHT
        : AlignmentType.LEFT,
      spacing: { before: 0, after: 0, line: 240 },
      children: inlineRuns(text, {
        bold: heading,
        color: heading ? COLORS.white : COLORS.body,
        size: heading ? 19 : 18,
      }),
    })],
  })

  return new Table({
    width: { size: BODY_WIDTH_DXA, type: WidthType.DXA },
    indent: { size: 120, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    borders,
    margins: { top: 90, bottom: 90, left: 110, right: 110 },
    rows: [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: header.map((cell, columnIndex) => makeCell(cell, columnIndex, { heading: true })),
      }),
      ...rows.map((row, rowIndex) => new TableRow({
        cantSplit: true,
        children: row.map((cell, columnIndex) => makeCell(cell, columnIndex, { alternate: rowIndex % 2 === 1 })),
      })),
    ],
  })
}

const blockToDocumentChildren = (block) => {
  if (block.type === 'heading') {
    const heading = block.level === 1
      ? HeadingLevel.HEADING_1
      : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3
    return [new Paragraph({ heading, keepNext: true, children: inlineRuns(block.text) })]
  }
  if (block.type === 'bullet') {
    return [new Paragraph({
      bullet: { level: 0 },
      spacing: { after: 90, line: 300 },
      children: inlineRuns(block.text),
    })]
  }
  if (block.type === 'number') {
    return [new Paragraph({
      numbering: { reference: 'candidate-numbering', level: 0 },
      spacing: { after: 90, line: 300 },
      children: inlineRuns(block.text),
    })]
  }
  if (block.type === 'quote') {
    return [new Paragraph({
      spacing: { before: 120, after: 180, line: 300 },
      indent: { left: 280, right: 180 },
      shading: { type: ShadingType.CLEAR, fill: COLORS.paleBlue, color: 'auto' },
      borders: { left: { style: BorderStyle.SINGLE, size: 20, color: COLORS.blue, space: 10 } },
      children: inlineRuns(block.text, { color: COLORS.body, italics: true }),
    })]
  }
  if (block.type === 'code') {
    return block.text.split('\n').map((line) => new Paragraph({
      spacing: { before: 0, after: 0, line: 260 },
      indent: { left: 280, right: 180 },
      shading: { type: ShadingType.CLEAR, fill: COLORS.paleGray, color: 'auto' },
      children: [new TextRun({ text: line || ' ', font: 'Courier New', size: 18, color: COLORS.navy })],
    }))
  }
  if (block.type === 'table') {
    return [makeTable(block), new Paragraph({ spacing: { after: 100 }, children: [] })]
  }
  if (block.type === 'divider') {
    return [new Paragraph({
      spacing: { before: 80, after: 180 },
      borders: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLORS.border, space: 1 } },
      children: [],
    })]
  }
  return [new Paragraph({
    spacing: { after: 150, line: 310 },
    children: inlineRuns(block.text),
  })]
}

const createDocument = ({ documentMetadata, parsed }) => {
  const { title, deliverableType, versionNumber, status } = documentMetadata
  const headerLabel = `${deliverableType} | Version ${versionNumber}`

  return new Document({
    creator: 'StoryLineOS Output Service Engineering Candidate',
    lastModifiedBy: 'StoryLineOS Output Service Engineering Candidate',
    title,
    subject: deliverableType,
    description: 'Engineering candidate document. Product approval and customer activation are not implied.',
    revision: 1,
    features: { updateFields: true },
    numbering: {
      config: [{
        reference: 'candidate-numbering',
        levels: [{
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 430, hanging: 250 } } },
        }],
      }],
    },
    styles: {
      default: {
        document: {
          run: { font: 'Arial', size: 21, color: COLORS.body },
          paragraph: { spacing: { line: 300 } },
        },
      },
      paragraphStyles: [
        {
          id: 'CandidateTitle',
          name: 'Candidate Title',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: 'Arial', size: 42, bold: true, color: COLORS.navy },
          paragraph: { spacing: { before: 120, after: 140, line: 480 }, keepNext: true },
        },
        {
          id: 'CandidateEyebrow',
          name: 'Candidate Eyebrow',
          basedOn: 'Normal',
          next: 'CandidateTitle',
          quickFormat: true,
          run: { font: 'Arial', size: 17, bold: true, color: COLORS.blue, allCaps: true },
          paragraph: { spacing: { before: 0, after: 100 }, keepNext: true },
        },
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: 'Arial', size: 30, bold: true, color: COLORS.blue },
          paragraph: { spacing: { before: 320, after: 110 }, keepNext: true, outlineLevel: 0 },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: 'Arial', size: 25, bold: true, color: COLORS.blue },
          paragraph: { spacing: { before: 260, after: 90 }, keepNext: true, outlineLevel: 1 },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: 'Arial', size: 22, bold: true, color: COLORS.navy },
          paragraph: { spacing: { before: 220, after: 70 }, keepNext: true, outlineLevel: 2 },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12_240, height: 15_840 },
          margin: { top: 1_080, right: 1_080, bottom: 1_050, left: 1_080, header: 500, footer: 500 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            spacing: { after: 80 },
            borders: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border, space: 5 } },
            children: [new TextRun({ text: headerLabel, bold: true, size: 15, color: COLORS.navy })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { before: 80 },
            borders: { top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border, space: 5 } },
            children: [
              new TextRun({ text: `${deliverableType} | ${status} | Page `, size: 15, color: COLORS.muted }),
              new TextRun({ children: [PageNumber.CURRENT], size: 15, color: COLORS.muted }),
            ],
          })],
        }),
      },
      children: [
        new Paragraph({ style: 'CandidateEyebrow', children: [new TextRun(deliverableType)] }),
        new Paragraph({ style: 'CandidateTitle', children: [new TextRun(title)] }),
        new Paragraph({
          spacing: { after: 260 },
          borders: { bottom: { style: BorderStyle.SINGLE, size: 16, color: COLORS.blue, space: 8 } },
          children: [new TextRun({
            text: `Version ${versionNumber} | ${status}`,
            size: 18,
            color: COLORS.muted,
          })],
        }),
        ...parsed.blocks.flatMap(blockToDocumentChildren),
      ],
    }],
  })
}

const findEndOfCentralDirectory = (buffer) => {
  const signature = 0x06054b50
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset
  }
  return -1
}

const inspectCentralDirectory = (buffer) => {
  const eocdOffset = findEndOfCentralDirectory(buffer)
  if (eocdOffset < 0) failValidation('DOCX_END_RECORD_MISSING')
  const entryCount = buffer.readUInt16LE(eocdOffset + 10)
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16)
  if (entryCount > PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.limits.maxPackageEntries) {
    failValidation('DOCX_ENTRY_LIMIT_EXCEEDED', { maxEntries: PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.limits.maxPackageEntries })
  }

  const names = []
  let totalExpandedBytes = 0
  let offset = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      failValidation('DOCX_CENTRAL_DIRECTORY_INVALID')
    }
    const expandedBytes = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    names.push(name)
    totalExpandedBytes += expandedBytes
    offset += 46 + nameLength + extraLength + commentLength
  }

  const decodedNames = names.map((name) => decodeSecurityText(name))
  if (new Set(decodedNames).size !== decodedNames.length) failValidation('DOCX_DUPLICATE_ENTRY')
  if (totalExpandedBytes > PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.limits.maxExpandedBytes) {
    failValidation('DOCX_EXPANSION_LIMIT_EXCEEDED', {
      maxExpandedBytes: PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.limits.maxExpandedBytes,
    })
  }
  names.forEach((name, index) => {
    const decodedName = decodedNames[index]
    if (!name
      || decodedName.includes('\\')
      || decodedName.startsWith('/')
      || decodedName.split('/').includes('..')) {
      failValidation('DOCX_ENTRY_PATH_UNSAFE')
    }
    if (/\.(?:exe|dll|com|bat|cmd|ps1|js|vbs|jar|msi|scr|bin)$/i.test(decodedName)) {
      failValidation('DOCX_EXECUTABLE_ENTRY_NOT_ALLOWED')
    }
    if (/\.(?:zip|7z|rar|tar|gz|bz2|xz)$/i.test(decodedName)) {
      failValidation('DOCX_NESTED_ARCHIVE_NOT_ALLOWED')
    }
    if (/(?:vbaProject|macros?|embeddings|oleObject|externalLink|activeX)/i.test(decodedName)) {
      failValidation('DOCX_EMBEDDED_CONTENT_NOT_ALLOWED')
    }
  })
  return names
}

const assertXmlWellFormed = (xml) => {
  if (/<!doctype|<!entity/i.test(xml)) failValidation('DOCX_XML_DTD_NOT_ALLOWED')
  const stack = []
  const tags = xml.match(/<[^>]+>/g) || []
  for (const tag of tags) {
    if (/^<\?|^<!|^<\//.test(tag)) {
      if (/^<\//.test(tag)) {
        const name = tag.slice(2, -1).trim().split(/\s+/)[0]
        if (stack.pop() !== name) failValidation('DOCX_XML_MALFORMED')
      }
      continue
    }
    if (/\/>$/.test(tag)) continue
    const name = tag.slice(1, -1).trim().split(/\s+/)[0]
    if (name) stack.push(name)
  }
  if (stack.length > 0) failValidation('DOCX_XML_MALFORMED')
}

export const validateProfessionalDocumentCandidatePackage = async (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.subarray(0, 2).toString('utf8') !== 'PK') {
    failValidation('DOCX_ZIP_SIGNATURE_INVALID')
  }
  if (buffer.length > PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.limits.maxOutputBytes) {
    failValidation('DOCX_OUTPUT_LIMIT_EXCEEDED', {
      maxOutputBytes: PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.limits.maxOutputBytes,
    })
  }

  const names = inspectCentralDirectory(buffer)
  const requiredEntries = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml']
  requiredEntries.forEach((entry) => {
    if (!names.includes(entry)) failValidation('DOCX_CORE_ENTRY_MISSING', { entryType: entry.replace(/[^a-z]/gi, '_') })
  })

  let archive
  try {
    archive = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: false })
  } catch {
    failValidation('DOCX_ARCHIVE_INVALID')
  }

  let contentTypesXml
  try {
    contentTypesXml = await archive.file('[Content_Types].xml').async('string')
  } catch {
    failValidation('DOCX_ENTRY_READ_FAILED')
  }
  if (/(?:macroenabled|vbaproject)/i.test(contentTypesXml)) {
    failValidation('DOCX_MACRO_CONTENT_NOT_ALLOWED')
  }

  for (const name of names) {
    const file = archive.file(name)
    if (!file || (!name.endsWith('.xml') && !name.endsWith('.rels'))) continue
    let xml
    try {
      xml = await file.async('string')
    } catch {
      failValidation('DOCX_ENTRY_READ_FAILED')
    }
    assertXmlWellFormed(xml)
    if (name.endsWith('.rels')) {
      if (/TargetMode\s*=\s*["']External["']/i.test(xml)) failValidation('DOCX_EXTERNAL_RELATIONSHIP_NOT_ALLOWED')
      const targets = [...xml.matchAll(/Target\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1])
      targets.forEach((target) => {
        const decoded = decodeSecurityText(target)
        if (/(?:https?|ftp|file|data|javascript|vbscript|mailto|tel|sms|cid|blob|about):/.test(decoded)
          || decoded.startsWith('//')
          || decoded.startsWith('/')
          || /^[a-z]:[\\/]/.test(decoded)
          || decoded.includes('\\')
          || decoded.split('/').includes('..')) {
          failValidation('DOCX_RELATIONSHIP_TARGET_UNSAFE')
        }
      })
    }
  }

  return Object.freeze({
    status: 'PASS',
    checks: Object.freeze([
      'DOCX_ZIP_SIGNATURE_VALID',
      'DOCX_CORE_ENTRIES_PRESENT',
      'DOCX_ENTRY_PATHS_SAFE',
      'DOCX_NO_EXECUTABLE_OR_EMBEDDED_CONTENT',
      'DOCX_XML_WELL_FORMED',
      'DOCX_RELATIONSHIPS_INTERNAL_ONLY',
      'DOCX_PACKAGE_LIMITS_VALID',
    ]),
    entryCount: names.length,
    contentIncludedInValidation: false,
  })
}

const normalizePackage = async (buffer) => {
  const archive = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: false })
  const core = archive.file('docProps/core.xml')
  if (core) {
    const xml = (await core.async('string'))
      .replace(/<dcterms:created[^>]*>[^<]*<\/dcterms:created>/g, '<dcterms:created xsi:type="dcterms:W3CDTF">2000-01-01T00:00:00Z</dcterms:created>')
      .replace(/<dcterms:modified[^>]*>[^<]*<\/dcterms:modified>/g, '<dcterms:modified xsi:type="dcterms:W3CDTF">2000-01-01T00:00:00Z</dcterms:modified>')
    archive.file('docProps/core.xml', xml, { date: FIXED_PACKAGE_DATE })
  }
  Object.values(archive.files).forEach((file) => { file.date = FIXED_PACKAGE_DATE })
  return archive.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'DOS',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}

export const renderProfessionalDocumentCandidate = async ({
  documentMetadata = {},
  markdown = '',
} = {}) => {
  const {
    documentMetadata: normalizedMetadata,
    source,
    parsed,
  } = parseProfessionalDocumentCandidateInput({ documentMetadata, markdown })
  const startedAt = Date.now()
  let buffer
  try {
    buffer = await Packer.toBuffer(createDocument({ documentMetadata: normalizedMetadata, parsed }))
    buffer = await normalizePackage(buffer)
  } catch (error) {
    if (error?.name === 'ProfessionalDocumentCandidateError') throw error
    throw createCandidateError({
      code: PROFESSIONAL_DOCUMENT_CANDIDATE_ERROR_CODES.RENDER_FAILED,
      reason: 'DOCX_CANDIDATE_RENDER_FAILED',
    })
  }
  const renderTimeMs = Date.now() - startedAt
  if (renderTimeMs > PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.limits.renderTargetMs) {
    logger.warn({
      profileKey: PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.profileKey,
      renderTimeMs,
      renderTargetMs: PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.limits.renderTargetMs,
    }, 'professional document render exceeded soft latency target')
  }

  const validation = await validateProfessionalDocumentCandidatePackage(buffer)
  return {
    buffer,
    profile: PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE,
    metrics: Object.freeze({
      sourceBytes: utf8Length(source),
      outputBytes: buffer.length,
      blockCount: parsed.blocks.length,
      headingCount: parsed.headings,
      tableCount: parsed.tables,
      renderTimeMs,
      contentIncludedInMetrics: false,
    }),
    validation,
  }
}

export const __testables = Object.freeze({
  assertSafeRenderedText,
  inspectCentralDirectory,
  parseMarkdown,
})
