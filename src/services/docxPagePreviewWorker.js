import { readFile, writeFile, lstat } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas'
import { DOCX_PAGE_LIMITS, assertPreviewDimensions, pagePreviewFailure, validatePreviewPng } from './docxPagePreviewRuntime.js'

const fail = reason => { throw pagePreviewFailure(reason) }
const require = createRequire(import.meta.url)
class PreviewCanvasFactory {
  create(width, height) { const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext('2d') } }
  reset(target, width, height) { target.canvas.width = width; target.canvas.height = height }
  destroy(target) { target.canvas.width = 1; target.canvas.height = 1; target.canvas = null; target.context = null }
}

export const rasterizeDocxPreviewPdf = async directory => {
  // These are confined to the isolated rasterizer process, not the API globals.
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D })
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const filename = path.join(directory, 'out', 'input.pdf'), stat = await lstat(filename)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > DOCX_PAGE_LIMITS.pdf) fail('PDF_SIZE_INVALID')
  const buffer = await readFile(filename)
  const loading = pdfjs.getDocument({ data: new Uint8Array(buffer), disableFontFace: true, enableXfa: false,
    isEvalSupported: false, stopAtErrors: true, useSystemFonts: false, useWorkerFetch: false,
    disableAutoFetch: true, disableStream: true, canvasFactory: new PreviewCanvasFactory(),
    standardFontDataUrl: path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep,
    verbosity: pdfjs.VerbosityLevel.WARNINGS })
  let document
  try {
    document = await loading.promise
    if (!Number.isInteger(document.numPages) || document.numPages < 1 || document.numPages > DOCX_PAGE_LIMITS.pages) fail('PDF_PAGE_LIMIT')
    const [attachments, actions, hasActions, fields, calculation, openAction] = await Promise.all([
      document.getAttachments(), document.getJSActions(), document.hasJSActions(), document.getFieldObjects(),
      document.getCalculationOrderIds(), document.getOpenAction(),
    ])
    if (attachments || actions || hasActions || fields || calculation?.length || openAction || document.isPureXfa) fail('PDF_ACTIVE_CONTENT')
    const dimensions = []
    let pixels = 0
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number), viewport = page.getViewport({ scale: 150 / 72 })
      const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height)
      assertPreviewDimensions(width, height)
      pixels += width * height
      if (pixels > DOCX_PAGE_LIMITS.pixels) fail('PDF_PIXEL_LIMIT')
      if ((await page.getAnnotations()).length) fail('PDF_ANNOTATION_UNSUPPORTED')
      dimensions.push({ width, height })
    }
    const pages = []
    let total = 0
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number), { width, height } = dimensions[number - 1]
      const target = new PreviewCanvasFactory().create(width, height)
      try {
        await page.render({ canvasContext: target.context, viewport: page.getViewport({ scale: 150 / 72 }) }).promise
        const bytes = target.canvas.toBuffer('image/png'), metadata = validatePreviewPng(bytes)
        total += bytes.length
        if (total > DOCX_PAGE_LIMITS.totalPng) fail('PNG_TOTAL_LIMIT')
        await writeFile(path.join(directory, 'pages', `page-${String(number).padStart(3, '0')}.png`), bytes, { flag: 'wx' })
        pages.push({ number, ...metadata })
      } finally { new PreviewCanvasFactory().destroy(target); page.cleanup() }
    }
    return { contractVersion: 'DOCX_PAGE_RASTER_V1', pages }
  } finally { if (document) await document.destroy(); else await loading.destroy() }
}

if (process.env.STORYLINEOS_DOCX_PAGE_WORKER === '1') {
  process.once('disconnect', () => process.exit(1))
  const directory = process.argv[2]
  try {
    const result = await rasterizeDocxPreviewPdf(directory)
    process.send(result, () => process.exit(0))
  } catch (error) {
    process.send({ contractVersion: 'DOCX_PAGE_RASTER_V1', error: error.details?.reason || 'RASTERIZATION_FAILED' }, () => process.exit(1))
  }
}
