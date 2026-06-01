import crypto from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import zlib from 'node:zlib'

const DISCOVERY_EVIDENCE_CATEGORIES = Object.freeze({
  COMPANY: 'Company',
  PRODUCTS: 'Products',
  SERVICES: 'Services',
  INDUSTRIES: 'Industries',
  TECHNOLOGY: 'Technology',
  DIFFERENTIATORS: 'Differentiators',
  VALUE_DRIVERS: 'Value Drivers',
  PROOF: 'Proof',
  ECONOMICS: 'Economics',
  CONSTRAINTS: 'Constraints',
  RISKS: 'Risks',
})

export const DISCOVERY_EVIDENCE_REVIEW_STATUSES = Object.freeze({
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
})

const DISCOVERY_COVERAGE_AREAS = Object.freeze([
  'Company',
  'Products',
  'Services',
  'Markets',
  'Industries',
  'Proof',
  'Economics',
  'Differentiation',
  'Decision Context',
  'Constraints',
])

const INPUT_EVIDENCE_MAP = Object.freeze({
  companyWebsite: {
    category: DISCOVERY_EVIDENCE_CATEGORIES.COMPANY,
    coverageArea: 'Company',
    label: 'Company Website',
    sourceType: 'WEBSITE',
    factPrefix: 'Company website',
  },
  companyName: {
    category: DISCOVERY_EVIDENCE_CATEGORIES.COMPANY,
    coverageArea: 'Company',
    label: 'Company Name',
    sourceType: 'DISCOVERY_NOTES',
    factPrefix: 'Company name',
  },
  marketRegion: {
    category: DISCOVERY_EVIDENCE_CATEGORIES.INDUSTRIES,
    coverageArea: 'Markets',
    label: 'Market / Region',
    sourceType: 'DISCOVERY_NOTES',
    factPrefix: 'Market or region',
  },
  targetOffer: {
    category: DISCOVERY_EVIDENCE_CATEGORIES.PRODUCTS,
    coverageArea: 'Products',
    label: 'Target Product or Offer',
    sourceType: 'DISCOVERY_NOTES',
    factPrefix: 'Target offer',
  },
  notes: {
    category: DISCOVERY_EVIDENCE_CATEGORIES.VALUE_DRIVERS,
    coverageArea: 'Decision Context',
    label: 'Intelligence Hub Notes',
    sourceType: 'DISCOVERY_NOTES',
    factPrefix: 'Intelligence Hub note',
  },
})

const WEBSITE_ACQUISITION_LIMITS = Object.freeze({
  timeoutMs: 6000,
  maxContentCharacters: 320000,
  maxEvidenceObjects: 20,
  maxCandidateSegments: 80,
  maxRedirects: 3,
})

const DOCUMENT_ACQUISITION_LIMITS = Object.freeze({
  maxDocuments: 5,
  maxFileBytes: 2_500_000,
  maxTextCharacters: 80000,
  maxEvidenceObjectsPerDocument: 30,
  maxCandidateSegments: 120,
})

const DOCUMENT_ASSET_TYPES = Object.freeze({
  CUSTOMER_DOCUMENT: 'CUSTOMER_DOCUMENT',
  CUSTOMER_NOTES: 'CUSTOMER_NOTES',
  PROPOSAL: 'PROPOSAL',
  ANNUAL_REPORT: 'ANNUAL_REPORT',
  STRATEGY_DECK: 'STRATEGY_DECK',
  COMPETITOR_ANALYSIS: 'COMPETITOR_ANALYSIS',
  PRODUCT_BROCHURE: 'PRODUCT_BROCHURE',
  IMPLEMENTATION_DOCUMENTATION: 'IMPLEMENTATION_DOCUMENTATION',
  REFERENCE_MATERIAL: 'REFERENCE_MATERIAL',
})

const DOCUMENT_TYPE_BY_MIME = Object.freeze({
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'text/csv': 'TXT',
  'text/markdown': 'TXT',
  'text/plain': 'TXT',
})

const DOCUMENT_TYPE_BY_EXTENSION = Object.freeze({
  '.csv': 'TXT',
  '.docx': 'DOCX',
  '.md': 'TXT',
  '.pdf': 'PDF',
  '.txt': 'TXT',
})

const WEBSITE_EXTRACTION_RULES = Object.freeze([
  {
    category: DISCOVERY_EVIDENCE_CATEGORIES.PRODUCTS,
    coverageArea: 'Products',
    pattern: /\b(product|products|platform|offer|solution|solutions|capability|capabilities|feature|features|software|tool|tools)\b/i,
  },
  {
    category: DISCOVERY_EVIDENCE_CATEGORIES.SERVICES,
    coverageArea: 'Services',
    pattern: /\b(service|services|consulting|implementation|support|managed|delivery|advisory)\b/i,
  },
  {
    category: DISCOVERY_EVIDENCE_CATEGORIES.INDUSTRIES,
    coverageArea: 'Industries',
    pattern: /\b(industry|industries|sector|sectors|market|markets|enterprise|retail|finance|healthcare|public sector)\b/i,
  },
  {
    category: DISCOVERY_EVIDENCE_CATEGORIES.TECHNOLOGY,
    coverageArea: 'Technology',
    pattern: /\b(ai|artificial intelligence|automation|data|integration|api|cloud|security|workflow|technology|machine learning)\b/i,
  },
  {
    category: DISCOVERY_EVIDENCE_CATEGORIES.PROOF,
    coverageArea: 'Proof',
    pattern: /\b(customer|customers|case study|testimonial|trusted|clients|used by|outcome|outcomes|results)\b/i,
  },
  {
    category: DISCOVERY_EVIDENCE_CATEGORIES.ECONOMICS,
    coverageArea: 'Economics',
    pattern: /\b(revenue|cost|roi|saving|savings|efficiency|growth|productivity|margin|conversion)\b/i,
  },
  {
    category: DISCOVERY_EVIDENCE_CATEGORIES.DIFFERENTIATORS,
    coverageArea: 'Differentiation',
    pattern: /\b(unique|different|differentiated|differentiator|native|governed|certified|trusted|leading)\b/i,
  },
  {
    category: DISCOVERY_EVIDENCE_CATEGORIES.VALUE_DRIVERS,
    coverageArea: 'Decision Context',
    pattern: /\b(value|benefit|benefits|improve|reduce|accelerate|faster|risk|governance|control)\b/i,
  },
])

const isPlainObject = (value) =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const toIdString = (value) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && value._id) return String(value._id)
  return String(value)
}

const hashValue = (value) =>
  crypto.createHash('sha256').update(JSON.stringify(value ?? '')).digest('hex').slice(0, 12)

const hashBuffer = (value) =>
  crypto.createHash('sha256').update(value).digest('hex')

const normalizeReviewStatus = (value) => {
  const normalized = String(value || '').trim().toUpperCase()
  return Object.values(DISCOVERY_EVIDENCE_REVIEW_STATUSES).includes(normalized)
    ? normalized
    : DISCOVERY_EVIDENCE_REVIEW_STATUSES.PENDING
}

const sanitizeFact = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')

const STYLE_OR_CODE_FRAGMENT_PATTERNS = Object.freeze([
  /stylablebutton/i,
  /\b(?:width|height|min-width|min-height|padding|margin|display|cursor|border|box-sizing|background-color|box-shadow|pointer-events|touch-action|transition|transform|animation|opacity|z-index|font-size|line-height|position|overflow)\s*:/i,
  /:[a-z-]+(?:\([^)]*\))?(?::[a-z-]+(?:\([^)]*\))?)*\{/i,
  /\bcubic-bezier\s*\(/i,
  /\bvar\(--/i,
  /--[a-z0-9-]+/i,
  /__[a-z0-9-]+/i,
  /[{}][^.!?]*;/,
])

const countNaturalLanguageTokens = (value) =>
  (String(value || '').match(/\b[A-Za-z][A-Za-z'-]{1,}\b/g) || []).length

const countWhitespaceSeparatedWords = (value) =>
  String(value || '').split(/\s+/).filter((token) => /[A-Za-z]{2,}/.test(token)).length

export const isGovernedDiscoveryEvidenceFact = (value) => {
  const fact = sanitizeFact(value)
  if (!fact) return false

  const text = fact
    .replace(/^(?:Website|Document)\s+(?:title|description|heading|body|Customer Document|Customer Notes|Proposal|Annual Report|Strategy Deck|Competitor Analysis|Product Brochure|Implementation Documentation|Reference Material):\s*/i, '')
    .trim()
  if (!text) return false

  if (STYLE_OR_CODE_FRAGMENT_PATTERNS.some((pattern) => pattern.test(text))) return false

  const symbolCount = (text.match(/[{}[\];=<>]/g) || []).length
  if (symbolCount >= 3 && symbolCount / Math.max(text.length, 1) > 0.04) return false

  const naturalLanguageTokens = countNaturalLanguageTokens(text)
  const whitespaceWords = countWhitespaceSeparatedWords(text)
  return naturalLanguageTokens >= 3 && whitespaceWords >= 3
}

const normalizeDocumentAssetType = (value) => {
  const normalized = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  return Object.values(DOCUMENT_ASSET_TYPES).includes(normalized)
    ? normalized
    : DOCUMENT_ASSET_TYPES.CUSTOMER_DOCUMENT
}

const formatDocumentAssetLabel = (value) => String(value || DOCUMENT_ASSET_TYPES.CUSTOMER_DOCUMENT)
  .trim()
  .toLowerCase()
  .split('_')
  .filter(Boolean)
  .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
  .join(' ')

const normalizeDocumentFileName = (value) => {
  const trimmed = String(value || '').trim()
  const fileName = trimmed.split(/[\\/]+/).filter(Boolean).pop() || ''
  return fileName.slice(0, 255)
}

const getDocumentExtension = (fileName = '') => {
  const normalized = String(fileName || '').trim().toLowerCase()
  const dotIndex = normalized.lastIndexOf('.')
  return dotIndex >= 0 ? normalized.slice(dotIndex) : ''
}

const getDocumentType = ({ fileName, mimeType }) => {
  const normalizedMimeType = String(mimeType || '').trim().toLowerCase().split(';')[0]
  const extension = getDocumentExtension(fileName)
  return DOCUMENT_TYPE_BY_MIME[normalizedMimeType] || DOCUMENT_TYPE_BY_EXTENSION[extension] || ''
}

const decodeDocumentBuffer = (documentSource = {}) => {
  const textContent = String(documentSource?.textContent || '').trim()
  if (textContent) {
    return Buffer.from(textContent, 'utf8')
  }

  const base64Content = String(documentSource?.contentBase64 || '').trim()
  if (!base64Content) return Buffer.alloc(0)

  const cleanedBase64 = base64Content.includes(',')
    ? base64Content.slice(base64Content.indexOf(',') + 1)
    : base64Content

  try {
    return Buffer.from(cleanedBase64, 'base64')
  } catch {
    return Buffer.alloc(0)
  }
}

const decodeHtmlEntities = (value) => String(value ?? '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/&apos;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')

const stripHtmlToText = (value) => decodeHtmlEntities(String(value ?? '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
  .replace(/<[^>]+>/g, ' '))

const normalizeWebsiteHostname = (hostname) =>
  String(hostname || '').trim().toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/^www\./, '')

const normalizeWebsiteHostForNetworkCheck = (hostname) =>
  String(hostname || '').trim().toLowerCase().replace(/^\[(.*)\]$/, '$1')

const isBlockedIpv4 = (hostname) => {
  const parts = String(hostname || '').split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false

  const [a, b, c] = parts
  return a === 0
    || a === 10
    || (a === 100 && b >= 64 && b <= 127)
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
}

const isBlockedIpv6 = (hostname) => {
  const normalizedHostname = normalizeWebsiteHostForNetworkCheck(hostname)
  return normalizedHostname === '::'
    || normalizedHostname === '::1'
    || normalizedHostname.startsWith('::ffff:')
    || normalizedHostname.startsWith('64:ff9b:')
    || normalizedHostname.startsWith('100:')
    || normalizedHostname.startsWith('2001:db8:')
    || normalizedHostname.startsWith('2002:')
    || normalizedHostname.startsWith('fc')
    || normalizedHostname.startsWith('fd')
    || /^fe[89ab]/i.test(normalizedHostname)
    || normalizedHostname.startsWith('ff')
}

const isBlockedWebsiteHost = (hostname) => {
  const normalizedHostname = normalizeWebsiteHostForNetworkCheck(hostname)
  if (!normalizedHostname) return true
  if (normalizedHostname === 'localhost' || normalizedHostname.endsWith('.localhost')) return true

  const ipType = isIP(normalizedHostname)
  if (ipType === 4) return isBlockedIpv4(normalizedHostname)
  if (ipType === 6) return isBlockedIpv6(normalizedHostname)

  return false
}

const getWebsiteDnsLookup = () =>
  (typeof globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ === 'function'
    ? globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__
    : lookup)

const assertWebsiteResolvesPublicly = async (hostname) => {
  const normalizedHostname = normalizeWebsiteHostForNetworkCheck(hostname)
  if (isBlockedWebsiteHost(normalizedHostname)) {
    throw new Error('Website acquisition target must remain a publicly accessible domain.')
  }
  if (isIP(normalizedHostname)) return

  let records
  try {
    records = await getWebsiteDnsLookup()(normalizedHostname, { all: true, verbatim: true })
  } catch {
    throw new Error('Website acquisition could not verify public DNS resolution.')
  }

  const resolvedAddresses = Array.isArray(records) ? records.map((record) => record?.address).filter(Boolean) : []
  if (resolvedAddresses.length === 0) {
    throw new Error('Website acquisition could not verify public DNS resolution.')
  }
  if (resolvedAddresses.some((address) => isBlockedWebsiteHost(address))) {
    throw new Error('Website acquisition target must remain a publicly accessible domain.')
  }
}

export const normalizeDiscoveryWebsiteUrl = (
  value,
  { fieldLabel = 'Company website', requireHttps = false } = {},
) => {
  const rawUrl = String(value ?? '').trim()
  if (!rawUrl) {
    throw new Error(`${fieldLabel} is required for acquisition.`)
  }

  if (requireHttps && !/^https:\/\//i.test(rawUrl)) {
    throw new Error('Enter the full URL including https://')
  }

  let parsedUrl
  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    throw new Error(`${fieldLabel} must be a valid ${requireHttps ? 'https' : 'http or https'} URL.`)
  }

  if (requireHttps && parsedUrl.protocol !== 'https:') {
    throw new Error('Enter the full URL including https://')
  }

  if (!requireHttps && !['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`${fieldLabel} must use http or https.`)
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error(`${fieldLabel} must not include credentials.`)
  }

  if (isBlockedWebsiteHost(parsedUrl.hostname)) {
    throw new Error(`${fieldLabel} must be a publicly accessible domain.`)
  }

  parsedUrl.hash = ''
  return parsedUrl.toString()
}

const assertWebsiteDomainBoundary = ({ requestedUrl, finalUrl }) => {
  const requested = new URL(requestedUrl)
  const final = new URL(finalUrl || requestedUrl)
  if (normalizeWebsiteHostname(requested.hostname) !== normalizeWebsiteHostname(final.hostname)) {
    throw new Error('Website acquisition redirected outside the requested domain.')
  }
  if (isBlockedWebsiteHost(final.hostname)) {
    throw new Error('Website acquisition target must remain a publicly accessible domain.')
  }
}

const readWebsiteResponseText = async (response, { signal } = {}) => {
  const maxCharacters = WEBSITE_ACQUISITION_LIMITS.maxContentCharacters
  if (!response?.body?.getReader) {
    const contentLength = Number(response?.headers?.get?.('content-length'))
    if (!Number.isFinite(contentLength) || contentLength > maxCharacters) {
      throw new Error('Website acquisition response exceeds the supported size limit.')
    }
    const text = String(await response.text())
    return {
      text: text.slice(0, maxCharacters),
      truncated: text.length > maxCharacters,
      characterLimit: maxCharacters,
      charactersRead: Math.min(text.length, maxCharacters),
    }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let truncated = false

  try {
    while (true) {
      if (signal?.aborted) {
        throw new Error('Website acquisition timed out.')
      }
      const { done, value } = await reader.read()
      if (done) break
      const decodedChunk = decoder.decode(value, { stream: true })
      const remainingCharacters = maxCharacters - text.length
      if (decodedChunk.length > remainingCharacters) {
        text += decodedChunk.slice(0, Math.max(0, remainingCharacters))
        truncated = true
        await reader.cancel?.()
        break
      }
      text += decodedChunk
      if (text.length >= maxCharacters) {
        truncated = true
        await reader.cancel?.()
        break
      }
    }
    if (!truncated) {
      const finalChunk = decoder.decode()
      const remainingCharacters = maxCharacters - text.length
      if (finalChunk.length > remainingCharacters) {
        text += finalChunk.slice(0, Math.max(0, remainingCharacters))
        truncated = true
      } else {
        text += finalChunk
      }
    }
    return {
      text,
      truncated,
      characterLimit: maxCharacters,
      charactersRead: text.length,
    }
  } finally {
    reader.releaseLock?.()
  }
}

const fetchWebsiteWithGovernedRedirects = async ({ normalizedUrl, signal }) => {
  let currentUrl = normalizedUrl

  for (let redirectCount = 0; redirectCount <= WEBSITE_ACQUISITION_LIMITS.maxRedirects; redirectCount += 1) {
    const currentParsedUrl = new URL(currentUrl)
    await assertWebsiteResolvesPublicly(currentParsedUrl.hostname)

    let response
    try {
      response = await globalThis.fetch(currentUrl, {
        redirect: 'manual',
        signal,
        headers: {
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.8',
          'user-agent': 'StorylineOS-Discovery-Acquisition/1.0',
        },
      })
    } catch (err) {
      throw new Error(err?.name === 'AbortError'
        ? 'Website acquisition timed out.'
        : 'Website acquisition could not fetch the requested website.')
    }

    const status = Number(response?.status)
    if (status >= 300 && status < 400) {
      const location = response.headers?.get?.('location')
      if (!location) {
        throw new Error('Website acquisition redirect was missing a target location.')
      }
      const nextUrl = new URL(location, currentUrl).toString()
      assertWebsiteDomainBoundary({ requestedUrl: normalizedUrl, finalUrl: nextUrl })
      await assertWebsiteResolvesPublicly(new URL(nextUrl).hostname)
      currentUrl = nextUrl
      continue
    }

    return response
  }

  throw new Error('Website acquisition exceeded the supported redirect limit.')
}

const extractHtmlMatch = (html, pattern) => {
  const match = String(html || '').match(pattern)
  return sanitizeFact(stripHtmlToText(match?.[1] || ''))
}

const extractHtmlSegments = (html) => {
  const sourceHtml = String(html || '')
  const title = extractHtmlMatch(sourceHtml, /<title[^>]*>([\s\S]*?)<\/title>/i)
  const description = extractHtmlMatch(
    sourceHtml,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  ) || extractHtmlMatch(
    sourceHtml,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i,
  )
  const headingMatches = Array.from(sourceHtml.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi))
    .map((match) => sanitizeFact(stripHtmlToText(match[1])))
  const bodySegments = stripHtmlToText(sourceHtml)
    .split(/[.!?\n\r]+/)
    .map(sanitizeFact)
    .filter((segment) => segment.length >= 24 && segment.length <= 260)
    .filter(isGovernedDiscoveryEvidenceFact)

  const segments = [
    title ? { kind: 'title', text: title } : null,
    description ? { kind: 'description', text: description } : null,
    ...headingMatches.map((text) => ({ kind: 'heading', text })),
    ...bodySegments.slice(0, WEBSITE_ACQUISITION_LIMITS.maxCandidateSegments).map((text) => ({ kind: 'body', text })),
  ].filter(Boolean)
    .filter((segment) => isGovernedDiscoveryEvidenceFact(segment.text))

  const seen = new Set()
  return segments.filter((segment) => {
    const key = segment.text.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const classifyWebsiteSegment = (segment) => {
  if (segment.kind === 'title' || segment.kind === 'description') {
    return {
      category: DISCOVERY_EVIDENCE_CATEGORIES.COMPANY,
      coverageArea: 'Company',
    }
  }

  const matchedRule = WEBSITE_EXTRACTION_RULES.find((rule) => rule.pattern.test(segment.text))
  return matchedRule || {
    category: DISCOVERY_EVIDENCE_CATEGORIES.VALUE_DRIVERS,
    coverageArea: 'Decision Context',
  }
}

const extractDocumentSegments = (text) => {
  const sourceText = sanitizeFact(String(text || '').slice(0, DOCUMENT_ACQUISITION_LIMITS.maxTextCharacters))
  if (!sourceText) return []

  const sentenceSegments = sourceText
    .split(/(?<=[.!?])\s+|[\n\r]+/)
    .map(sanitizeFact)
    .filter((segment) => segment.length >= 18 && segment.length <= 320)

  const fallbackSegments = sourceText
    .split(/\s{2,}|[;|•]+/)
    .map(sanitizeFact)
    .filter((segment) => segment.length >= 18 && segment.length <= 320)

  const segments = [...sentenceSegments, ...fallbackSegments]
  const seen = new Set()

  return segments
    .filter((segment) => {
      const key = segment.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, DOCUMENT_ACQUISITION_LIMITS.maxCandidateSegments)
    .map((textSegment, index) => ({
      kind: index === 0 ? 'summary' : 'body',
      text: textSegment,
    }))
}

const classifyDocumentSegment = (segment) => {
  const matchedRule = WEBSITE_EXTRACTION_RULES.find((rule) => rule.pattern.test(segment.text))
  return matchedRule || {
    category: DISCOVERY_EVIDENCE_CATEGORIES.VALUE_DRIVERS,
    coverageArea: 'Decision Context',
  }
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
  return sanitizeFact(utf16Text || buffer.toString('utf8') || buffer.toString('latin1'))
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

  return sanitizeFact([...literals, ...arrayLiterals, ...hexStrings].filter(Boolean).join(' '))
}

const extractPdfText = (buffer) => {
  const rawText = buffer.toString('latin1')
  const extractedParts = [extractPdfOperatorText(rawText)]
  const streamPattern = /(<<[\s\S]{0,1200}?>>)\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g

  for (const match of rawText.matchAll(streamPattern)) {
    const descriptor = match[1] || ''
    const streamBytes = Buffer.from(match[2] || '', 'binary')
    let streamText = ''

    if (/\/FlateDecode\b/i.test(descriptor)) {
      try {
        streamText = zlib.inflateSync(streamBytes).toString('latin1')
      } catch {
        try {
          streamText = zlib.inflateRawSync(streamBytes).toString('latin1')
        } catch {
          streamText = ''
        }
      }
    } else {
      streamText = streamBytes.toString('latin1')
    }

    if (streamText) extractedParts.push(extractPdfOperatorText(streamText))
  }

  const printableFallback = rawText
    .replace(/[^\x20-\x7E\n\r\t]+/g, ' ')
    .replace(/\b(obj|endobj|xref|trailer|stream|endstream)\b/gi, ' ')

  return sanitizeFact([...extractedParts, printableFallback].filter(Boolean).join(' '))
}

const inflateZipEntryData = ({ compressedData, compressionMethod }) => {
  if (compressionMethod === 0) return compressedData
  if (compressionMethod === 8) {
    try {
      return zlib.inflateRawSync(compressedData)
    } catch {
      return Buffer.alloc(0)
    }
  }
  return Buffer.alloc(0)
}

const readZipEntriesFromCentralDirectory = (buffer) => {
  const entries = []
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

    if (
      fileNameEnd > buffer.length
      || nextOffset > buffer.length
      || compressedSize === 0
      || localHeaderOffset + 30 > buffer.length
      || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50
    ) {
      offset = Math.max(offset + 4, nextOffset)
      continue
    }

    const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > buffer.length) {
      offset = Math.max(offset + 4, nextOffset)
      continue
    }

    const fileName = buffer.slice(fileNameStart, fileNameEnd).toString('utf8')
    const compressedData = buffer.slice(dataStart, dataEnd)
    const data = inflateZipEntryData({ compressedData, compressionMethod })
    entries.push({ fileName, data })
    offset = nextOffset
  }

  return entries
}

const readZipEntries = (buffer) => {
  const centralDirectoryEntries = readZipEntriesFromCentralDirectory(buffer)
  if (centralDirectoryEntries.length > 0) return centralDirectoryEntries

  const entries = []
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
    if (fileNameEnd > buffer.length || dataEnd > buffer.length || compressedSize === 0) {
      offset += 4
      continue
    }

    const fileName = buffer.slice(fileNameStart, fileNameEnd).toString('utf8')
    const compressedData = buffer.slice(dataStart, dataEnd)
    const data = inflateZipEntryData({ compressedData, compressionMethod })

    entries.push({ fileName, data })
    offset = dataEnd
  }

  return entries
}

const stripXmlToText = (xml) => decodeHtmlEntities(String(xml || '')
  .replace(/<w:tab\s*\/>/gi, ' ')
  .replace(/<\/w:p>/gi, '\n')
  .replace(/<[^>]+>/g, ' '))

const extractDocxText = (buffer) => {
  const entries = readZipEntries(buffer)
  const documentEntry = entries.find((entry) => entry.fileName === 'word/document.xml')
  if (!documentEntry?.data?.length) return ''
  return sanitizeFact(stripXmlToText(documentEntry.data.toString('utf8')))
}

const extractDocumentText = ({ buffer, documentType }) => {
  if (documentType === 'TXT') return sanitizeFact(buffer.toString('utf8'))
  if (documentType === 'PDF') return extractPdfText(buffer)
  if (documentType === 'DOCX') return extractDocxText(buffer)
  return ''
}

const buildDocumentEvidenceObjects = ({
  acquisitionProfile,
  assetType,
  capturedAt,
  fileName,
  segments,
  sourceId,
} = {}) => segments
  .slice(0, DOCUMENT_ACQUISITION_LIMITS.maxEvidenceObjectsPerDocument)
  .map((segment) => {
    const classification = classifyDocumentSegment(segment)
    const extractedFact = sanitizeFact(`Document ${formatDocumentAssetLabel(assetType)}: ${segment.text}`)
    const evidenceHash = hashValue({
      sourceId,
      extractedFact,
      acquisitionProfile,
    })

    return {
      evidenceObjectId: `evidence_document_${evidenceHash}`,
      sourceId,
      category: classification.category,
      coverageArea: classification.coverageArea,
      extractedFact,
      confidence: {
        level: 'SOURCE_BACKED',
        score: 74,
        basis: ['UPLOADED_DOCUMENT', 'DETERMINISTIC_TEXT_EXTRACTION'],
      },
      createdAt: capturedAt,
      reviewStatus: DISCOVERY_EVIDENCE_REVIEW_STATUSES.PENDING,
      acquisitionMethod: 'DOCUMENT_INGESTION',
      extractionTimestamp: capturedAt,
      acceptedBy: '',
      acceptanceTimestamp: '',
      rejectedBy: '',
      rejectionTimestamp: '',
      auditRef: '',
      lineageRef: `lineage:${sourceId}:${evidenceHash}`,
      acquisitionProfile,
      sourceFileName: fileName,
      documentAssetType: assetType,
    }
  })

const buildWebsiteEvidenceObjects = ({
  acquisitionProfile,
  acquiredAt,
  finalUrl,
  sourceId,
  segments,
} = {}) => segments
  .slice(0, WEBSITE_ACQUISITION_LIMITS.maxEvidenceObjects)
  .map((segment) => {
    const classification = classifyWebsiteSegment(segment)
    const extractedFact = sanitizeFact(`Website ${segment.kind}: ${segment.text}`)
    const evidenceHash = hashValue({
      sourceId,
      extractedFact,
      acquisitionProfile,
    })

    return {
      evidenceObjectId: `evidence_website_${evidenceHash}`,
      sourceId,
      category: classification.category,
      coverageArea: classification.coverageArea,
      extractedFact,
      confidence: {
        level: 'SOURCE_BACKED',
        score: 72,
        basis: ['WEBSITE_PAGE_ACQUIRED', 'DETERMINISTIC_TEXT_EXTRACTION'],
      },
      createdAt: acquiredAt,
      reviewStatus: DISCOVERY_EVIDENCE_REVIEW_STATUSES.PENDING,
      acquisitionMethod: 'WEBSITE_ACQUISITION',
      extractionTimestamp: acquiredAt,
      acceptedBy: '',
      acceptanceTimestamp: '',
      rejectedBy: '',
      rejectionTimestamp: '',
      auditRef: '',
      lineageRef: `lineage:${sourceId}:${evidenceHash}`,
      acquisitionProfile,
      sourceUrl: finalUrl,
    }
  })

export const acquireWebsiteDiscoveryEvidence = async ({
  acquisitionProfile,
  acquiredAt,
  websiteUrl,
} = {}) => {
  const normalizedUrl = normalizeDiscoveryWebsiteUrl(websiteUrl)

  if (typeof globalThis.fetch !== 'function') {
    throw new Error('Website acquisition is not available in this runtime.')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), WEBSITE_ACQUISITION_LIMITS.timeoutMs)

  let response
  try {
    response = await fetchWebsiteWithGovernedRedirects({
      normalizedUrl,
      signal: controller.signal,
    })
  } catch (err) {
    throw new Error(err?.message || 'Website acquisition could not fetch the requested website.')
  } finally {
    clearTimeout(timeout)
  }

  const finalUrl = response?.url || normalizedUrl
  assertWebsiteDomainBoundary({ requestedUrl: normalizedUrl, finalUrl })

  if (!response?.ok) {
    throw new Error(`Website acquisition failed with HTTP ${response?.status || 'error'}.`)
  }

  const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase()
  if (contentType && !/(text\/html|application\/xhtml\+xml|text\/plain)/i.test(contentType)) {
    throw new Error('Website acquisition only supports HTML or plain text pages in this sprint.')
  }

  const {
    characterLimit,
    charactersRead,
    text: html,
    truncated: contentTruncated,
  } = await readWebsiteResponseText(response, { signal: controller.signal })
  const segments = extractHtmlSegments(html)
  if (segments.length === 0) {
    throw new Error('Website acquisition did not find extractable customer website text.')
  }

  const sourceId = `website_${hashValue({ normalizedUrl })}`
  const evidenceObjects = buildWebsiteEvidenceObjects({
    acquisitionProfile,
    acquiredAt,
    finalUrl,
    sourceId,
    segments,
  })

  if (evidenceObjects.length === 0) {
    throw new Error('Website acquisition did not produce reviewable evidence.')
  }

  const source = {
    sourceId,
    type: 'WEBSITE_ACQUISITION',
    sourceType: 'WEBSITE',
    label: 'Website Source',
    url: normalizedUrl,
    finalUrl,
    valueHash: `sha256:${hashValue({ html })}`,
    status: 'ACQUIRED',
    capturedAt: acquiredAt,
    acquisitionProfile,
    evidenceProduced: evidenceObjects.length,
    lineageRef: `lineage:${sourceId}`,
    adapter: 'website-html-fetch-v1',
    pageCount: 1,
    contentTruncated,
    contentCharactersRead: charactersRead,
    contentCharacterLimit: characterLimit,
  }

  const sourceRegistryEntry = {
    sourceId,
    sourceType: 'WEBSITE',
    label: 'Website Source',
    status: 'AVAILABLE',
    dateAdded: acquiredAt,
    acquisitionStatus: 'ACQUIRED',
    evidenceProduced: evidenceObjects.length,
    lastAcquisitionAt: acquiredAt,
    lineageRef: `lineage:${sourceId}`,
    acquisitionProfile,
    url: normalizedUrl,
    finalUrl,
    contentTruncated,
    contentCharactersRead: charactersRead,
    contentCharacterLimit: characterLimit,
  }

  return {
    source,
    sourceRegistryEntry,
    evidenceObjects,
  }
}

export const ingestUploadedDocumentDiscoveryEvidence = ({
  acquisitionProfile,
  capturedAt,
  documentSources = [],
} = {}) => {
  const candidateDocuments = Array.isArray(documentSources)
    ? documentSources.slice(0, DOCUMENT_ACQUISITION_LIMITS.maxDocuments)
    : []

  if (candidateDocuments.length === 0) {
    return {
      sources: [],
      sourceRegistry: [],
      evidenceObjects: [],
    }
  }

  return candidateDocuments.reduce((result, documentSource, index) => {
    const fileName = normalizeDocumentFileName(documentSource?.fileName)
    const mimeType = String(documentSource?.mimeType || '').trim().toLowerCase().split(';')[0]
    const assetType = normalizeDocumentAssetType(documentSource?.assetType)
    const documentType = getDocumentType({ fileName, mimeType })
    const buffer = decodeDocumentBuffer(documentSource)
    const reportedSizeBytes = Number(documentSource?.sizeBytes || buffer.length)

    if (!fileName) {
      throw new Error('Uploaded document fileName is required.')
    }

    if (!documentType) {
      throw new Error('Uploaded document must be PDF, DOCX, or TXT.')
    }

    if (!buffer.length) {
      throw new Error(`Uploaded document ${fileName} has no readable content.`)
    }

    if (reportedSizeBytes > DOCUMENT_ACQUISITION_LIMITS.maxFileBytes || buffer.length > DOCUMENT_ACQUISITION_LIMITS.maxFileBytes) {
      throw new Error(`Uploaded document ${fileName} exceeds the supported file size.`)
    }

    const extractedText = extractDocumentText({ buffer, documentType })
    const segments = extractDocumentSegments(extractedText)

    if (segments.length === 0) {
      throw new Error(`Uploaded document ${fileName} did not produce reviewable evidence.`)
    }

    const documentHash = `sha256:${hashBuffer(buffer)}`
    const sourceId = `document_${hashValue({
      fileName,
      documentHash,
      index,
    })}`
    const evidenceObjects = buildDocumentEvidenceObjects({
      acquisitionProfile,
      assetType,
      capturedAt,
      fileName,
      segments,
      sourceId,
    })

    if (evidenceObjects.length === 0) {
      throw new Error(`Uploaded document ${fileName} did not produce reviewable evidence.`)
    }

    const label = `${formatDocumentAssetLabel(assetType)}: ${fileName}`
    const source = {
      sourceId,
      documentId: sourceId,
      type: 'UPLOADED_DOCUMENT',
      sourceType: 'UPLOADED_DOCUMENT',
      label,
      fileName,
      mimeType,
      documentType,
      assetType,
      sizeBytes: buffer.length,
      valueHash: documentHash,
      documentHash,
      documentStatus: 'PROCESSED',
      ingestionMode: 'TEXT_NATIVE',
      uploadedAt: capturedAt,
      status: 'ACQUIRED',
      capturedAt,
      acquisitionStatus: 'ACQUIRED',
      acquisitionProfile,
      evidenceProduced: evidenceObjects.length,
      evidenceObjectsGenerated: evidenceObjects.length,
      acceptedEvidenceObjects: 0,
      rejectedEvidenceObjects: 0,
      pendingEvidenceObjects: evidenceObjects.length,
      lineageRef: `lineage:${sourceId}`,
      adapter: `document-${documentType.toLowerCase()}-text-extraction-v1`,
    }
    const sourceRegistryEntry = {
      sourceId,
      documentId: sourceId,
      sourceType: 'UPLOADED_DOCUMENT',
      label,
      status: 'AVAILABLE',
      dateAdded: capturedAt,
      acquisitionStatus: 'ACQUIRED',
      evidenceProduced: evidenceObjects.length,
      evidenceObjectsGenerated: evidenceObjects.length,
      acceptedEvidenceObjects: 0,
      rejectedEvidenceObjects: 0,
      pendingEvidenceObjects: evidenceObjects.length,
      lastAcquisitionAt: capturedAt,
      lineageRef: `lineage:${sourceId}`,
      acquisitionProfile,
      fileName,
      mimeType,
      documentType,
      assetType,
      sizeBytes: buffer.length,
      documentHash,
      documentStatus: 'PROCESSED',
      ingestionMode: 'TEXT_NATIVE',
      uploadedAt: capturedAt,
    }

    return {
      sources: [...result.sources, source],
      sourceRegistry: [...result.sourceRegistry, sourceRegistryEntry],
      evidenceObjects: [...result.evidenceObjects, ...evidenceObjects],
    }
  }, {
    sources: [],
    sourceRegistry: [],
    evidenceObjects: [],
  })
}

const buildSourceRegistryEntryFromLineage = ({
  evidenceObjects,
  capturedAt,
  source,
}) => {
  const sourceId = String(source?.sourceId || '').trim()
  if (!sourceId) return null

  const fieldKey = String(source?.fieldKey || '').trim()
  const inputConfig = INPUT_EVIDENCE_MAP[fieldKey] || {}
  const sourceEvidenceObjects = evidenceObjects.filter((evidenceObject) =>
    evidenceObject.sourceId === sourceId,
  )
  const firstEvidenceObject = sourceEvidenceObjects[0] || {}

  return {
    sourceId,
    sourceType: inputConfig.sourceType || source.sourceType || source.type || 'DISCOVERY_NOTES',
    label: inputConfig.label || source.label || fieldKey || sourceId,
    status: 'AVAILABLE',
    dateAdded: source.capturedAt || capturedAt || '',
    acquisitionStatus: source.acquisitionStatus || (source.status === 'USER_PROVIDED' ? 'CAPTURED' : 'ACQUIRED'),
    evidenceProduced: Number(source.evidenceProduced || sourceEvidenceObjects.length),
    lastAcquisitionAt: source.capturedAt || capturedAt || '',
    lineageRef: firstEvidenceObject.lineageRef || `lineage:${sourceId}`,
    acquisitionProfile: source.acquisitionProfile || '',
    ...(fieldKey ? { fieldKey } : {}),
    ...(source.url ? { url: source.url } : {}),
    ...(source.finalUrl ? { finalUrl: source.finalUrl } : {}),
    ...(source.fileName ? { fileName: source.fileName } : {}),
    ...(source.mimeType ? { mimeType: source.mimeType } : {}),
    ...(source.documentType ? { documentType: source.documentType } : {}),
    ...(source.assetType ? { assetType: source.assetType } : {}),
    ...(Number.isFinite(Number(source.sizeBytes)) ? { sizeBytes: Number(source.sizeBytes) } : {}),
    ...(source.documentHash ? { documentHash: source.documentHash } : {}),
    ...(source.documentId ? { documentId: source.documentId } : {}),
    ...(source.documentStatus ? { documentStatus: source.documentStatus } : {}),
    ...(source.ingestionMode ? { ingestionMode: source.ingestionMode } : {}),
    ...(source.uploadedAt ? { uploadedAt: source.uploadedAt } : {}),
    ...(source.uploadedBy ? { uploadedBy: source.uploadedBy } : {}),
    ...(source.failureReason ? { failureReason: source.failureReason } : {}),
    ...(source.failureReasonCode ? { failureReasonCode: source.failureReasonCode } : {}),
    ...(Number.isFinite(Number(source.evidenceObjectsGenerated))
      ? { evidenceObjectsGenerated: Number(source.evidenceObjectsGenerated) }
      : {}),
    ...(Number.isFinite(Number(source.acceptedEvidenceObjects))
      ? { acceptedEvidenceObjects: Number(source.acceptedEvidenceObjects) }
      : {}),
    ...(Number.isFinite(Number(source.rejectedEvidenceObjects))
      ? { rejectedEvidenceObjects: Number(source.rejectedEvidenceObjects) }
      : {}),
    ...(Number.isFinite(Number(source.pendingEvidenceObjects))
      ? { pendingEvidenceObjects: Number(source.pendingEvidenceObjects) }
      : {}),
  }
}

export const buildDiscoveryEvidenceObjectsFromSources = ({
  acquisitionProfile,
  createdAt,
  inputs = {},
  sources = [],
} = {}) => sources
  .map((source) => {
    const fieldKey = String(source?.fieldKey || '').trim()
    const inputConfig = INPUT_EVIDENCE_MAP[fieldKey]
    const factValue = sanitizeFact(inputs?.[fieldKey])
    const sourceId = String(source?.sourceId || '').trim()

    if (!inputConfig || !factValue || !sourceId) return null

    const lineageHash = hashValue({
      sourceId,
      fieldKey,
      factValue,
      acquisitionProfile,
    })

    return {
      evidenceObjectId: `evidence_${fieldKey}_${lineageHash}`,
      sourceId,
      category: inputConfig.category,
      coverageArea: inputConfig.coverageArea,
      extractedFact: `${inputConfig.factPrefix}: ${factValue}`,
      confidence: {
        level: 'USER_PROVIDED',
        score: 65,
        basis: ['DETERMINISTIC_DISCOVERY_INPUT'],
      },
      createdAt,
      reviewStatus: DISCOVERY_EVIDENCE_REVIEW_STATUSES.PENDING,
      acquisitionMethod: 'CUSTOMER_PROVIDED_INPUT',
      extractionTimestamp: createdAt,
      acceptedBy: '',
      acceptanceTimestamp: '',
      rejectedBy: '',
      rejectionTimestamp: '',
      auditRef: '',
      lineageRef: `lineage:${sourceId}:${lineageHash}`,
      acquisitionProfile,
    }
  })
  .filter(Boolean)

export const normalizeDiscoveryEvidenceObjects = ({
  acquisitionProfile,
  createdAt,
  evidenceObjects,
  inputs,
  sources,
} = {}) => {
  const candidateObjects = Array.isArray(evidenceObjects) && evidenceObjects.length > 0
    ? evidenceObjects
    : buildDiscoveryEvidenceObjectsFromSources({
        acquisitionProfile,
        createdAt,
        inputs,
        sources,
      })

  return candidateObjects
    .map((evidenceObject) => {
      const evidenceObjectId = String(evidenceObject?.evidenceObjectId || '').trim()
      const sourceId = String(evidenceObject?.sourceId || '').trim()
      const extractedFact = sanitizeFact(evidenceObject?.extractedFact)
      if (!evidenceObjectId || !sourceId || !extractedFact) return null

      const reviewStatus = normalizeReviewStatus(evidenceObject.reviewStatus)
      const acquisitionMethod = evidenceObject.acquisitionMethod || 'CUSTOMER_PROVIDED_INPUT'
      if (
        acquisitionMethod === 'WEBSITE_ACQUISITION'
        && !isGovernedDiscoveryEvidenceFact(extractedFact)
      ) {
        return null
      }

      return {
        evidenceObjectId,
        sourceId,
        category: evidenceObject.category || DISCOVERY_EVIDENCE_CATEGORIES.COMPANY,
        coverageArea: evidenceObject.coverageArea || evidenceObject.category || 'Company',
        extractedFact,
        confidence: isPlainObject(evidenceObject.confidence)
          ? evidenceObject.confidence
          : {
              level: String(evidenceObject.confidence || 'USER_PROVIDED'),
              score: 65,
              basis: ['DETERMINISTIC_DISCOVERY_INPUT'],
            },
        createdAt: evidenceObject.createdAt || createdAt || '',
        reviewStatus,
        acquisitionMethod,
        extractionTimestamp: evidenceObject.extractionTimestamp || evidenceObject.createdAt || createdAt || '',
        acceptedBy: reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED
          ? toIdString(evidenceObject.acceptedBy)
          : '',
        acceptanceTimestamp: reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED
          ? String(evidenceObject.acceptanceTimestamp || '')
          : '',
        rejectedBy: reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED
          ? toIdString(evidenceObject.rejectedBy)
          : '',
        rejectionTimestamp: reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED
          ? String(evidenceObject.rejectionTimestamp || '')
          : '',
        auditRef: String(evidenceObject.auditRef || ''),
        lineageRef: String(evidenceObject.lineageRef || `lineage:${sourceId}`),
        acquisitionProfile: evidenceObject.acquisitionProfile || acquisitionProfile || '',
        ...(evidenceObject.sourceUrl ? { sourceUrl: String(evidenceObject.sourceUrl).trim() } : {}),
        ...(evidenceObject.sourceFileName ? { sourceFileName: String(evidenceObject.sourceFileName).trim() } : {}),
        ...(evidenceObject.documentAssetType ? { documentAssetType: String(evidenceObject.documentAssetType).trim() } : {}),
      }
    })
    .filter(Boolean)
}

export const buildDiscoveryEvidenceReviewSummary = (evidenceObjects = []) => {
  const summary = {
    evidenceObjectCount: evidenceObjects.length,
    acceptedEvidenceCount: 0,
    pendingReviewCount: 0,
    rejectedEvidenceCount: 0,
  }

  evidenceObjects.forEach((evidenceObject) => {
    const reviewStatus = normalizeReviewStatus(evidenceObject?.reviewStatus)
    if (reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED) {
      summary.acceptedEvidenceCount += 1
      return
    }
    if (reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED) {
      summary.rejectedEvidenceCount += 1
      return
    }
    summary.pendingReviewCount += 1
  })

  return summary
}

export const buildDiscoverySourceRegistry = ({
  capturedAt,
  evidenceObjects = [],
  sourceRegistry,
  sources = [],
} = {}) => {
  const existingRegistry = Array.isArray(sourceRegistry) ? sourceRegistry : []
  const registry = existingRegistry.length > 0
    ? existingRegistry
    : sources
        .map((source) => buildSourceRegistryEntryFromLineage({
          evidenceObjects,
          capturedAt,
          source,
        }))
        .filter(Boolean)

  return registry.map((source) => {
    const sourceId = String(source?.sourceId || '').trim()
    const sourceEvidenceObjects = evidenceObjects.filter((evidenceObject) =>
      evidenceObject?.sourceId === sourceId,
    )
    const reviewSummary = buildDiscoveryEvidenceReviewSummary(sourceEvidenceObjects)
    const evidenceProduced = Number(source?.evidenceProduced || sourceEvidenceObjects.length || 0)

    return {
      sourceId,
      sourceType: String(source?.sourceType || source?.type || 'DISCOVERY_NOTES').trim(),
      label: String(source?.label || sourceId || '').trim(),
      status: String(source?.status || 'AVAILABLE').trim().toUpperCase(),
      dateAdded: String(source?.dateAdded || source?.capturedAt || capturedAt || '').trim(),
      acquisitionStatus: String(source?.acquisitionStatus || 'CAPTURED').trim().toUpperCase(),
      evidenceProduced,
      lastAcquisitionAt: String(source?.lastAcquisitionAt || source?.dateAdded || capturedAt || '').trim(),
      lineageRef: String(source?.lineageRef || `lineage:${sourceId}`).trim(),
      acquisitionProfile: String(source?.acquisitionProfile || '').trim(),
      ...(source?.fieldKey ? { fieldKey: String(source.fieldKey).trim() } : {}),
      ...(source?.url ? { url: String(source.url).trim() } : {}),
      ...(source?.finalUrl ? { finalUrl: String(source.finalUrl).trim() } : {}),
      ...(source?.fileName ? { fileName: String(source.fileName).trim() } : {}),
      ...(source?.mimeType ? { mimeType: String(source.mimeType).trim() } : {}),
      ...(source?.documentType ? { documentType: String(source.documentType).trim() } : {}),
      ...(source?.assetType ? { assetType: String(source.assetType).trim() } : {}),
      ...(Number.isFinite(Number(source?.sizeBytes)) ? { sizeBytes: Number(source.sizeBytes) } : {}),
      ...(source?.documentHash ? { documentHash: String(source.documentHash).trim() } : {}),
      ...(source?.documentId ? { documentId: String(source.documentId).trim() } : {}),
      ...(source?.documentStatus ? { documentStatus: String(source.documentStatus).trim().toUpperCase() } : {}),
      ...(source?.ingestionMode ? { ingestionMode: String(source.ingestionMode).trim().toUpperCase() } : {}),
      ...(source?.uploadedAt ? { uploadedAt: String(source.uploadedAt).trim() } : {}),
      ...(source?.uploadedBy ? { uploadedBy: String(source.uploadedBy).trim() } : {}),
      ...(source?.failureReason ? { failureReason: String(source.failureReason).trim() } : {}),
      ...(source?.failureReasonCode ? { failureReasonCode: String(source.failureReasonCode).trim() } : {}),
      ...(source?.contentTruncated !== undefined ? { contentTruncated: Boolean(source.contentTruncated) } : {}),
      ...(Number.isFinite(Number(source?.contentCharactersRead)) ? { contentCharactersRead: Number(source.contentCharactersRead) } : {}),
      ...(Number.isFinite(Number(source?.contentCharacterLimit)) ? { contentCharacterLimit: Number(source.contentCharacterLimit) } : {}),
      evidenceObjectsGenerated: Number(source?.evidenceObjectsGenerated || evidenceProduced || 0),
      acceptedEvidenceObjects: reviewSummary.acceptedEvidenceCount,
      rejectedEvidenceObjects: reviewSummary.rejectedEvidenceCount,
      pendingEvidenceObjects: reviewSummary.pendingReviewCount,
    }
  }).filter((source) => source.sourceId)
}

export const applyDiscoveryEvidenceReview = ({
  actorUserId,
  evidenceObjectId,
  evidenceObjects = [],
  reviewStatus,
  reviewedAt,
} = {}) => {
  const normalizedEvidenceObjectId = String(evidenceObjectId || '').trim()
  const normalizedReviewStatus = normalizeReviewStatus(reviewStatus)
  let found = false

  const nextEvidenceObjects = evidenceObjects.map((evidenceObject) => {
    if (evidenceObject.evidenceObjectId !== normalizedEvidenceObjectId) return evidenceObject
    found = true

    return {
      ...evidenceObject,
      reviewStatus: normalizedReviewStatus,
      acceptedBy: normalizedReviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED
        ? toIdString(actorUserId)
        : '',
      acceptanceTimestamp: normalizedReviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED
        ? reviewedAt
        : '',
      rejectedBy: normalizedReviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED
        ? toIdString(actorUserId)
        : '',
      rejectionTimestamp: normalizedReviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED
        ? reviewedAt
        : '',
    }
  })

  return {
    found,
    evidenceObjects: nextEvidenceObjects,
  }
}

export const acceptPendingDiscoveryEvidenceObjects = ({
  acceptedAt,
  actorUserId,
  evidenceObjects = [],
} = {}) => evidenceObjects.map((evidenceObject) => {
  if (normalizeReviewStatus(evidenceObject?.reviewStatus) === DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED) {
    return {
      ...evidenceObject,
      reviewStatus: DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED,
    }
  }

  return {
    ...evidenceObject,
    reviewStatus: DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED,
    acceptedBy: toIdString(actorUserId),
    acceptanceTimestamp: acceptedAt,
    rejectedBy: '',
    rejectionTimestamp: '',
  }
})

export const buildDiscoveryCoverageAreas = (evidenceObjects = []) => {
  const activeEvidenceObjects = evidenceObjects.filter((evidenceObject) =>
    normalizeReviewStatus(evidenceObject.reviewStatus) !== DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED,
  )

  return DISCOVERY_COVERAGE_AREAS.map((area) => {
    const matchingObjects = activeEvidenceObjects.filter((evidenceObject) =>
      String(evidenceObject.coverageArea || '').trim() === area,
    )
    const acceptedCount = matchingObjects.filter((evidenceObject) =>
      normalizeReviewStatus(evidenceObject.reviewStatus) === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED,
    ).length
    const pendingCount = matchingObjects.filter((evidenceObject) =>
      normalizeReviewStatus(evidenceObject.reviewStatus) === DISCOVERY_EVIDENCE_REVIEW_STATUSES.PENDING,
    ).length
    const evidenceCount = matchingObjects.length
    let state = 'MISSING'

    if (acceptedCount >= 2) {
      state = 'STRONG'
    } else if (acceptedCount >= 1) {
      state = 'ADEQUATE'
    } else if (evidenceCount >= 1 || pendingCount > 0) {
      state = 'WEAK'
    }

    return {
      area,
      state,
      evidenceCount,
      acceptedEvidenceCount: acceptedCount,
      pendingReviewCount: pendingCount,
    }
  })
}

export const buildDiscoveryHealth = ({
  acquisitionProfile,
  coverage,
  evidenceObjects = [],
  lastAcquisitionDate,
  sourceRegistry = [],
} = {}) => {
  const reviewSummary = buildDiscoveryEvidenceReviewSummary(evidenceObjects)
  const coverageAreas = buildDiscoveryCoverageAreas(evidenceObjects)
  const coveredAreaCount = coverageAreas.filter((area) => area.state !== 'MISSING').length
  const coveragePercent = coverageAreas.length > 0
    ? Math.round((coveredAreaCount / coverageAreas.length) * 100)
    : 0
  const missingAreas = coverageAreas
    .filter((area) => area.state === 'MISSING')
    .map((area) => area.area)

  return {
    coveragePercent,
    confidence: coverage?.confidence?.level || coverage?.confidenceLevel || 'USER_PROVIDED',
    evidenceObjectCount: reviewSummary.evidenceObjectCount,
    acceptedEvidenceCount: reviewSummary.acceptedEvidenceCount,
    pendingReviewCount: reviewSummary.pendingReviewCount,
    rejectedEvidenceCount: reviewSummary.rejectedEvidenceCount,
    sourceCount: sourceRegistry.length,
    missingAreas,
    acquisitionProfile,
    lastAcquisitionDate: lastAcquisitionDate || '',
    coverageAreas,
  }
}

export const buildAcceptedDiscoveryScopedViews = ({
  acquisitionProfile,
  evidenceObjects = [],
  inputHash = '',
  previousScopedViews = {},
  refreshedAt = '',
} = {}) => {
  const acceptedEvidenceObjects = evidenceObjects.filter((evidenceObject) =>
    normalizeReviewStatus(evidenceObject?.reviewStatus) === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED,
  )
  const sourceRefs = Array.from(new Set(acceptedEvidenceObjects
    .map((evidenceObject) => String(evidenceObject.sourceId || '').trim())
    .filter(Boolean)))
  const evidenceObjectIds = acceptedEvidenceObjects
    .map((evidenceObject) => String(evidenceObject.evidenceObjectId || '').trim())
    .filter(Boolean)
  const evidenceFacts = acceptedEvidenceObjects.slice(0, 12).map((evidenceObject) => ({
    evidenceObjectId: String(evidenceObject.evidenceObjectId || '').trim(),
    sourceId: String(evidenceObject.sourceId || '').trim(),
    category: String(evidenceObject.category || '').trim(),
    coverageArea: String(evidenceObject.coverageArea || '').trim(),
    extractedFact: sanitizeFact(evidenceObject.extractedFact),
  })).filter((fact) => fact.evidenceObjectId && fact.extractedFact)
  const summaryFacts = evidenceFacts.slice(0, 6).map((fact) => fact.extractedFact)
  const summary = summaryFacts.length > 0
    ? summaryFacts.join(' ')
    : 'Accepted Intelligence Hub evidence is available for this section.'
  const scopedViews = isPlainObject(previousScopedViews) ? previousScopedViews : {}

  return Object.keys(scopedViews).reduce((views, sectionKey) => {
    const previousScopedView = scopedViews[sectionKey]
    views[sectionKey] = {
      ...(isPlainObject(previousScopedView) ? previousScopedView : {}),
      source: 'DISCOVERY_EVIDENCE_OBJECTS',
      summary,
      reviewStatus: 'ACCEPTED_ONLY',
      evidenceKeys: ['evidenceObjects.accepted'],
      sourceRefs,
      evidenceObjectIds,
      evidenceFacts,
      refreshedAt,
      acquisitionProfile,
      evidenceHash: `sha256:${hashValue({
        sectionKey,
        inputHash,
        sourceRefs,
        evidenceObjectIds,
        acquisitionProfile,
      })}`,
    }
    return views
  }, {})
}

export const summarizeDiscoveryIntelligence = ({
  acquisitionProfile,
  coverage,
  evidenceObjects,
  lastAcquisitionDate,
  sourceRegistry,
} = {}) => ({
  reviewSummary: buildDiscoveryEvidenceReviewSummary(evidenceObjects),
  discoveryHealth: buildDiscoveryHealth({
    acquisitionProfile,
    coverage,
    evidenceObjects,
    lastAcquisitionDate,
    sourceRegistry,
  }),
})
