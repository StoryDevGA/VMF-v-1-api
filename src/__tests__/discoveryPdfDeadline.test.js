import { jest } from '@jest/globals'
import { createRequire } from 'node:module'

const getDocument = jest.fn()
jest.unstable_mockModule('pdfjs-dist/build/pdf.mjs', () => ({ getDocument, VerbosityLevel: { ERRORS: 0 } }))
const require = createRequire(import.meta.url)
const tesseract = require('tesseract.js')
const originalCreateWorker = tesseract.createWorker
const createWorker = jest.fn()
tesseract.createWorker = createWorker
const { ingestUploadedDocumentDiscoveryEvidence } = await import('../services/discoveryIntelligenceService.js')
const originalOcr = process.env.STORYLINEOS_PDF_OCR_ENABLED
const fact = 'The synthetic business provides workflow monitoring services to test customers in the United Kingdom.'
const deferred = () => {
  let resolve
  const promise = new Promise(yes => { resolve = yes })
  return { promise, resolve }
}
const cleanup = behavior => jest.fn(() => {
  if (behavior === 'throw') throw new Error('synthetic cleanup failure')
  if (behavior === 'reject') return Promise.reject(new Error('synthetic cleanup failure'))
  if (behavior === 'stall') return new Promise(() => {})
  return Promise.resolve()
})
const pdf = (overrides = {}) => ({ numPages: 1, destroy: cleanup('complete'),
  getPage: jest.fn(async () => ({ getTextContent: jest.fn(async () => ({ items: [{ str: fact }] })),
    getViewport: () => ({ width: 10, height: 10 }), render: () => ({ promise: Promise.resolve() }) })), ...overrides })
const worker = (overrides = {}) => ({ setParameters: jest.fn(async () => {}), terminate: cleanup('complete'),
  recognize: jest.fn(async () => ({ data: { text: fact, confidence: 90 } })), ...overrides })
const acquire = () => ingestUploadedDocumentDiscoveryEvidence({ acquisitionProfile: 'STANDARD',
  capturedAt: '2026-10-05T10:00:00.000Z', batchOutcomes: true,
  documentSources: [{ fileName: 'synthetic.pdf', mimeType: 'application/pdf',
    contentBase64: Buffer.from('%PDF-1.4\nsynthetic test without operator text').toString('base64') }] })
const failed = result => {
  expect(result.sources).toEqual([])
  expect(result.itemOutcomes[0].status).toBe('FAILED')
}
beforeEach(() => {
  jest.useFakeTimers()
  getDocument.mockReset()
  createWorker.mockReset()
  process.env.STORYLINEOS_PDF_OCR_ENABLED = 'false'
})
afterEach(() => { jest.useRealTimers() })
afterAll(() => {
  tesseract.createWorker = originalCreateWorker
  if (originalOcr === undefined) delete process.env.STORYLINEOS_PDF_OCR_ENABLED
  else process.env.STORYLINEOS_PDF_OCR_ENABLED = originalOcr
})

test.each(['stall', 'reject', 'throw'])('text deadline is15s when destroy %s', async behavior => {
  const text = deferred()
  const document = pdf({ destroy: cleanup(behavior), getPage: jest.fn(async () => ({ getTextContent: () => text.promise })) })
  getDocument.mockReturnValue({ promise: Promise.resolve(document) })
  let settled = false
  const result = acquire().then(value => { settled = true; return value })
  await jest.advanceTimersByTimeAsync(14999)
  expect(settled).toBe(false)
  await jest.advanceTimersByTimeAsync(1)
  failed(await result)
  expect(document.destroy).toHaveBeenCalled()
  text.resolve({ items: [{ str: fact }] })
  await jest.advanceTimersByTimeAsync(0)
  failed(await result)
  expect(jest.getTimerCount()).toBe(0)
})

test('late PDF loading is cleaned up without starting page extraction', async () => {
  const loading = deferred()
  const document = pdf()
  getDocument.mockReturnValue({ promise: loading.promise })
  const result = acquire()
  await jest.advanceTimersByTimeAsync(15000)
  failed(await result)
  loading.resolve(document)
  await jest.advanceTimersByTimeAsync(0)
  expect(document.getPage).not.toHaveBeenCalled()
  expect(document.destroy).toHaveBeenCalledTimes(1)
})

const setupOcr = document => {
  process.env.STORYLINEOS_PDF_OCR_ENABLED = 'true'
  getDocument.mockReturnValueOnce({ promise: Promise.resolve(pdf({ numPages: 0 })) })
    .mockReturnValue({ promise: Promise.resolve(document) })
}

test.each(['stall', 'reject', 'throw'])('OCR deadline is90s when terminate %s', async behavior => {
  const recognition = deferred()
  const document = pdf({ destroy: cleanup(behavior) })
  const actualWorker = worker({ terminate: cleanup(behavior), recognize: jest.fn(() => recognition.promise) })
  setupOcr(document)
  createWorker.mockResolvedValue(actualWorker)
  let settled = false
  const result = acquire().then(value => { settled = true; return value })
  await jest.advanceTimersByTimeAsync(89999)
  expect(settled).toBe(false)
  expect(actualWorker.recognize).toHaveBeenCalledTimes(1)
  await jest.advanceTimersByTimeAsync(1)
  failed(await result)
  expect(actualWorker.terminate).toHaveBeenCalled()
  expect(document.destroy).toHaveBeenCalled()
  recognition.resolve({ data: { text: fact, confidence: 90 } })
  await jest.advanceTimersByTimeAsync(0)
  failed(await result)
  expect(jest.getTimerCount()).toBe(0)
})

test('late OCR worker is terminated without setup or recognition', async () => {
  const creating = deferred()
  const actualWorker = worker()
  const document = pdf()
  setupOcr(document)
  createWorker.mockReturnValue(creating.promise)
  const result = acquire()
  await jest.advanceTimersByTimeAsync(90000)
  failed(await result)
  expect(document.destroy).toHaveBeenCalled()
  creating.resolve(actualWorker)
  await jest.advanceTimersByTimeAsync(0)
  expect(actualWorker.terminate).toHaveBeenCalledTimes(1)
  expect(actualWorker.setParameters).not.toHaveBeenCalled()
  expect(actualWorker.recognize).not.toHaveBeenCalled()
})

test('stalled worker setup is cancelled and late setup cannot recognize', async () => {
  const setup = deferred()
  const actualWorker = worker({ setParameters: jest.fn(() => setup.promise) })
  setupOcr(pdf())
  createWorker.mockResolvedValue(actualWorker)
  const result = acquire()
  await jest.advanceTimersByTimeAsync(90000)
  failed(await result)
  expect(actualWorker.terminate).toHaveBeenCalled()
  setup.resolve()
  await jest.advanceTimersByTimeAsync(0)
  expect(actualWorker.recognize).not.toHaveBeenCalled()
})

test('normal readable PDF retains actual output and provenance', async () => {
  const document = pdf()
  getDocument.mockReturnValue({ promise: Promise.resolve(document) })
  const result = await acquire()
  expect(result.itemOutcomes[0]).toMatchObject({ status: 'SUCCEEDED', documentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) })
  expect(result.sources[0]).toMatchObject({ extractionMethod: 'PDF_TEXT_LAYER', ingestionMode: 'TEXT_NATIVE' })
  expect(result.evidenceObjects.length).toBeGreaterThan(0)
  expect(document.destroy).toHaveBeenCalledTimes(1)
  expect(createWorker).not.toHaveBeenCalled()
  expect(jest.getTimerCount()).toBe(0)
})

test('late text page cannot start text consumption', async () => {
  const page = deferred()
  const getTextContent = jest.fn(async () => ({ items: [{ str: fact }] }))
  const document = pdf({ getPage: jest.fn(() => page.promise) })
  getDocument.mockReturnValue({ promise: Promise.resolve(document) })
  const result = acquire()
  await jest.advanceTimersByTimeAsync(15000)
  failed(await result)
  page.resolve({ getTextContent })
  await jest.advanceTimersByTimeAsync(0)
  expect(getTextContent).not.toHaveBeenCalled()
})

test.each(['loading', 'page', 'render'])('late OCR %s cannot start the next provider stage', async stage => {
  const pending = deferred()
  const actualWorker = worker()
  const render = jest.fn(() => ({ promise: stage === 'render' ? pending.promise : Promise.resolve() }))
  const actualPage = { getViewport: () => ({ width: 10, height: 10 }), render }
  const document = pdf({ getPage: jest.fn(() => stage === 'page' ? pending.promise : Promise.resolve(actualPage)) })
  setupOcr(document)
  if (stage === 'loading') getDocument.mockReset().mockReturnValueOnce({ promise: Promise.resolve(pdf({ numPages: 0 })) })
    .mockReturnValue({ promise: pending.promise })
  createWorker.mockResolvedValue(actualWorker)
  const result = acquire()
  await jest.advanceTimersByTimeAsync(90000)
  failed(await result)
  pending.resolve(stage === 'loading' ? document : stage === 'page' ? actualPage : undefined)
  await jest.advanceTimersByTimeAsync(0)
  if (stage === 'loading') expect(createWorker).not.toHaveBeenCalled()
  if (stage === 'page') expect(render).not.toHaveBeenCalled()
  expect(actualWorker.recognize).not.toHaveBeenCalled()
  expect(document.destroy).toHaveBeenCalled()
})

test('normal OCR fallback retains extraction metadata and cleans up both resources', async () => {
  const document = pdf()
  const actualWorker = worker()
  setupOcr(document)
  createWorker.mockResolvedValue(actualWorker)
  const result = await acquire()
  expect(result.itemOutcomes[0].status).toBe('SUCCEEDED')
  expect(result.sources[0]).toMatchObject({ extractionMethod: 'PDF_OCR', ingestionMode: 'OCR_FALLBACK', ocrPagesProcessed: 1 })
  expect(actualWorker.terminate).toHaveBeenCalledTimes(1)
  expect(document.destroy).toHaveBeenCalledTimes(1)
  expect(jest.getTimerCount()).toBe(0)
})
