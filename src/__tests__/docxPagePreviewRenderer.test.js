import { jest, afterEach, test, expect } from '@jest/globals'
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import PDFDocument from 'pdfkit'
import { renderProfessionalDocumentCandidate } from '../services/professionalDocumentCandidateRenderer.js'
import { DOCX_PAGE_LIMITS, previewHash, pagePreviewFailure, validatePreviewPng, validateDocxPreviewRuntime,
  fingerprintDocxPreviewInstallation, assertPreviewDimensions } from '../services/docxPagePreviewRuntime.js'
import { previewChildEnvironment, runPreviewConversionProcess, stopPreviewProcessTree, terminatePreviewChild,
  trackPreviewChildClosure, __testables as processTestables } from '../services/docxPagePreviewProcesses.js'
import { cleanupDocxPreviewDirectory, __testables } from '../services/docxPagePreviewRenderer.js'

const roots = []
const ownedDirectory = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'storylineos-docx-pages-'))
  roots.push(root); return root
}
afterEach(async () => { for (const root of roots.splice(0)) await cleanupDocxPreviewDirectory(root, os.tmpdir()) })
const png = () => createCanvas(30, 40).toBuffer('image/png')
const docx = async () => (await renderProfessionalDocumentCandidate({
  documentMetadata: { title: 'Generic preview contract', deliverableType: 'Document', versionNumber: 1, status: 'DRAFT' },
  markdown: '# Generic preview contract\n\n## Bounded observation\n\nThis is generic test content.',
})).buffer
const pdf = async (size = [612, 792]) => new Promise(resolve => {
  const document = new PDFDocument({ size }), chunks = []
  document.on('data', chunk => chunks.push(chunk)); document.on('end', () => resolve(Buffer.concat(chunks)))
  document.text('Generic test page.'); document.end()
})
const runtime = { executable: 'unused', receipt: { contractVersion: 'TEST_ONLY', dpi: 150 }, fingerprint: 'f'.repeat(64) }
const prepare = async (directory, bytes) => {
  await mkdir(path.join(directory, 'out'), { recursive: true }); await mkdir(path.join(directory, 'pages'), { recursive: true })
  await writeFile(path.join(directory, 'out', 'input.pdf'), bytes || await pdf())
}

test('PNG validation independently checks CRC, scanlines, dimensions and trailing bytes', () => {
  const bytes = png()
  expect(validatePreviewPng(bytes)).toMatchObject({ width: 30, height: 40, byteLength: bytes.length, sha256: previewHash(bytes) })
  const changed = Buffer.from(bytes); changed[changed.length - 10] ^= 1
  expect(() => validatePreviewPng(changed)).toThrow()
  expect(() => validatePreviewPng(Buffer.concat([bytes, Buffer.from('extra')]))).toThrow()
  expect(() => validatePreviewPng(Buffer.from('not a PNG'))).toThrow()
  expect(() => assertPreviewDimensions(2501, 20)).toThrow()
  expect(() => assertPreviewDimensions(100, NaN)).toThrow()
})

test('child environment excludes configured credentials rather than inheriting process.env', () => {
  process.env.DOCX_PREVIEW_TEST_SECRET = 'must-not-leave-parent'
  try {
    const environment = previewChildEnvironment(os.tmpdir())
    expect(environment).not.toHaveProperty('DOCX_PREVIEW_TEST_SECRET')
    expect(Object.keys(environment).sort()).toEqual(['LANG', 'NODE_ENV', 'SystemRoot', 'TEMP', 'TMP', 'TZ', 'WINDIR'].sort())
  } finally { delete process.env.DOCX_PREVIEW_TEST_SECRET }
})

test('runtime profile binds complete install and four font hashes; unknown fields and drift reject', async () => {
  const root = await ownedDirectory(), installation = path.join(root, 'install')
  await mkdir(path.join(installation, 'program'), { recursive: true })
  await writeFile(path.join(installation, 'program', 'soffice.com'), 'Generic executable fixture, never run')
  const fingerprint = await fingerprintDocxPreviewInstallation(installation)
  const fonts = []
  for (const name of ['arial.ttf', 'arialbd.ttf', 'ariali.ttf', 'arialbi.ttf']) {
    const bytes = Buffer.from(`Generic ${name} bytes`), filename = path.join(root, name)
    await writeFile(filename, bytes); fonts.push({ path: filename, byteLength: bytes.length, sha256: previewHash(bytes) })
  }
  const profile = { contractVersion: 'DOCX_PAGE_RUNTIME_V1', installationRoot: installation,
    installationFingerprint: fingerprint.fingerprint, fileCount: fingerprint.fileCount, totalBytes: fingerprint.totalBytes,
    productVersion: '0.0.1', fonts }
  expect((await validateDocxPreviewRuntime(profile)).receipt.fonts).toHaveLength(4)
  await expect(validateDocxPreviewRuntime({ ...profile, untrusted: true })).rejects.toThrow()
  await expect(validateDocxPreviewRuntime({ ...profile, installationFingerprint: '0'.repeat(64) })).rejects.toThrow()
  await writeFile(fonts[0].path, 'Changed')
  await expect(validateDocxPreviewRuntime(profile)).rejects.toMatchObject({ details: { reason: 'FONT_CHANGED' } })
})

test('installation links and expired verification deadlines reject', async () => {
  const root = await ownedDirectory(), installation = path.join(root, 'install'), sibling = path.join(root, 'sibling')
  await mkdir(installation); await mkdir(sibling)
  await symlink(sibling, path.join(installation, 'linked'), 'junction')
  await expect(fingerprintDocxPreviewInstallation(installation)).rejects.toThrow()
  await expect(fingerprintDocxPreviewInstallation(sibling, Date.now() - 1)).rejects.toThrow()
})

test('actual rasterizer returns inspectable ordered images from PDF bytes', async () => {
  const root = await ownedDirectory(); await prepare(root)
  const run = await __testables.rasterize(root).catch(error => ({ errorReason: error.details?.reason, diagnostics: error.operatorDiagnostics }))
  expect(run).toEqual(expect.objectContaining({ result: expect.anything() }))
  const { result } = run
  expect(result.pages).toHaveLength(1)
  const bytes = await readFile(path.join(root, 'pages', 'page-001.png'))
  expect(result.pages[0]).toEqual({ number: 1, ...validatePreviewPng(bytes) })
  const image = await loadImage(bytes), canvas = createCanvas(image.width, image.height), context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, image.width, image.height).data
  let ink = 0
  for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 128 && pixels[index + 3] > 0) ink++
  expect(ink).toBeGreaterThan(20)
})

test.each(['malformed', 'oversized', 'active'])('real rasterizer refuses %s PDF before accepting pages', async mode => {
  const root = await ownedDirectory()
  let bytes
  if (mode === 'malformed') bytes = Buffer.from('not PDF')
  else if (mode === 'oversized') bytes = await pdf([2000, 2000])
  else bytes = await new Promise(resolve => {
    const document = new PDFDocument(), chunks = []
    document.on('data', chunk => chunks.push(chunk)); document.on('end', () => resolve(Buffer.concat(chunks)))
    document.text('Link', { link: 'https://example.com' }); document.end()
  })
  await prepare(root, bytes)
  await expect(__testables.rasterize(root)).rejects.toThrow()
  expect(await readdir(path.join(root, 'pages'))).toEqual([])
})

test.each(['hang', 'crash', 'invalid', 'partial'])('runner rejects %s worker without accepting partial output', async mode => {
  const root = await ownedDirectory(); await writeFile(path.join(root, 'fixture.json'), JSON.stringify({ mode }))
  const entry = fileURLToPath(new URL('./fixtures/docxPagePreviewWorker.fixture.js', import.meta.url))
  const operation = () => __testables.rasterize(root, { entry, timeoutMs: mode === 'hang' ? 1000 : 10000 })
  if (mode === 'partial') expect((await operation()).result.pages).toEqual([{ number: 1 }])
  else await expect(operation()).rejects.toThrow()
  const environment = JSON.parse(await readFile(path.join(root, 'fixture-environment.json'), 'utf8'))
  expect(environment.some(key => /MONGODB|PASSWORD|API_KEY|SECRET/.test(key))).toBe(false)
})

test('renderer binds actual input/output bytes and removes only its owned job directory', async () => {
  const parent = await ownedDirectory(), sentinel = path.join(parent, 'sentinel')
  await writeFile(sentinel, 'preserve')
  const buffer = await docx(), original = Buffer.from(buffer)
  const convert = jest.fn(async ({ directory }) => {
    await writeFile(path.join(directory, 'out', 'input.pdf'), await pdf())
    return { exitCode: 0, treeEmpty: true, observed: [], diagnostics: {} }
  })
  const render = __testables.createRenderer({ runtimeValidator: async () => runtime, convert, tempRoot: parent })
  const result = await render({ buffer, outputChecksum: `sha256:${previewHash(buffer)}` }).catch(error => ({ errorReason: error.details?.reason }))
  expect(result).not.toHaveProperty('errorReason')
  expect(buffer.equals(original)).toBe(true)
  expect(result.receipt).toMatchObject({ status: 'PRIVATE_PREVIEW_ONLY', deliveryAvailable: false, authorisesApproval: false })
  expect(result.receipt.pages[0].sha256).toBe(previewHash(result.pages[0].buffer))
  expect(await readdir(parent)).toEqual(['sentinel'])
  await expect(render({ buffer, outputChecksum: 'sha256:wrong' })).rejects.toThrow()
  expect(convert).toHaveBeenCalledTimes(1)
})

test('partial manifest is refused by independent parent byte checks and job is removed', async () => {
  const parent = await ownedDirectory(), buffer = await docx()
  const convert = async ({ directory }) => {
    await writeFile(path.join(directory, 'out', 'input.pdf'), await pdf())
    await writeFile(path.join(directory, 'fixture.json'), JSON.stringify({ mode: 'partial' }))
    return { exitCode: 0, treeEmpty: true }
  }
  const entry = fileURLToPath(new URL('./fixtures/docxPagePreviewWorker.fixture.js', import.meta.url))
  const render = __testables.createRenderer({ runtimeValidator: async () => runtime, convert, tempRoot: parent, rasterOptions: { entry } })
  await expect(render({ buffer, outputChecksum: `sha256:${previewHash(buffer)}` })).rejects.toMatchObject({ details: { reason: 'PAGE_MANIFEST_INVALID' } })
  expect(await readdir(parent)).toEqual([])
})

test('cleanup cannot remove sibling or unowned paths', async () => {
  const root = await ownedDirectory(), sibling = path.join(root, 'sibling')
  await mkdir(sibling)
  await expect(cleanupDocxPreviewDirectory(sibling, os.tmpdir())).rejects.toThrow()
  expect(await readdir(root)).toEqual(['sibling'])
})

test('missing converter fails without false process success', async () => {
  const root = await ownedDirectory()
  await expect(runPreviewConversionProcess({ executable: path.join(root, 'missing.com'), args: [], directory: root }))
    .rejects.toMatchObject({ details: { reason: 'CONVERTER_START_FAILED' } })
  expect(DOCX_PAGE_LIMITS.pages).toBe(20)
})

test('initial binding requires a live retained child and the exact bounded spawn interval', () => {
  const { bindInitialProcessIdentity, ticksAt } = processTestables
  const child = { pid: 123, exitCode: null, signalCode: null }
  const basis = { before: 1000, after: 1001, executable: 'soffice.com', parentPid: 10 }
  const root = { pid: 123, parent: 10, name: 'soffice.com', created: ticksAt(1001).toString() }
  expect(bindInitialProcessIdentity([root], child, basis)).toEqual([root])
  expect(() => bindInitialProcessIdentity([], child, basis)).toThrow()
  expect(() => bindInitialProcessIdentity([{ ...root, created: ticksAt(2000).toString() }], child, basis)).toThrow()
  expect(() => bindInitialProcessIdentity([{ ...root, parent: 999 }], child, basis)).toThrow()
  expect(() => bindInitialProcessIdentity([{ ...root, name: 'unrelated.exe' }], child, basis)).toThrow()
  expect(() => bindInitialProcessIdentity([root], { ...child, exitCode: 0 }, basis)).toThrow()
})

test('reused PID and unknown descendants of vanished parents are never adopted', async () => {
  const { assertObservedLineage } = processTestables
  const root = { pid: 123, parent: 10, name: 'soffice.com', created: '100000' }
  const child = { pid: 124, parent: 123, name: 'soffice.bin', created: '100001' }
  expect(assertObservedLineage([root, child], [root])).toEqual([root, child])
  expect(() => assertObservedLineage([{ ...root, created: '200000' }], [root])).toThrow()
  expect(() => assertObservedLineage([child], [root])).toThrow()
  expect(assertObservedLineage([child], [root, child])).toEqual([child])
  await expect(stopPreviewProcessTree(123, [])).rejects.toMatchObject({ details: { reason: 'PROCESS_CLEANUP_UNVERIFIED' } })
  await expect(stopPreviewProcessTree(999, [root])).rejects.toThrow()
})

test('retained-handle shutdown confirms closure and fails when closure is unconfirmed', async () => {
  const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null })
  child.kill = jest.fn(() => { queueMicrotask(() => { child.exitCode = 0; child.emit('close', 0) }); return true })
  await expect(terminatePreviewChild(child, 100)).resolves.toBeUndefined()
  expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  const stuck = Object.assign(new EventEmitter(), { pid: 999, exitCode: null, signalCode: null, kill: jest.fn(() => false) })
  await expect(terminatePreviewChild(stuck, 20)).rejects.toMatchObject({ details: { reason: 'PROCESS_CLEANUP_UNVERIFIED' } })
})

test('an already-exited child still needs bounded close confirmation', async () => {
  const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: 0, signalCode: null, kill: jest.fn() })
  trackPreviewChildClosure(child)
  const pending = terminatePreviewChild(child, 100)
  queueMicrotask(() => child.emit('close', 0))
  await expect(pending).resolves.toBeUndefined()
  expect(child.kill).not.toHaveBeenCalled()
  await expect(terminatePreviewChild(child, 20)).resolves.toBeUndefined()
  const unclosed = Object.assign(new EventEmitter(), { pid: 999, exitCode: 0, signalCode: null, kill: jest.fn() })
  await expect(terminatePreviewChild(unclosed, 20)).rejects.toThrow()
})

test.each(['PROCESS_IDENTITY_CHANGED', 'PROCESS_LINEAGE_UNVERIFIED', 'PROCESS_OBSERVATION_FAILED'])(
  'uncertain post-exit ownership %s preserves the owned job for explicit recovery', async reason => {
  const parent = await ownedDirectory(), buffer = await docx()
  const render = __testables.createRenderer({ runtimeValidator: async () => runtime, tempRoot: parent,
    convert: async () => { throw pagePreviewFailure(reason) } })
  await expect(render({ buffer, outputChecksum: `sha256:${previewHash(buffer)}` }))
    .rejects.toMatchObject({ details: { reason: 'PROCESS_CLEANUP_UNVERIFIED' } })
  const directories = await readdir(parent)
  expect(directories).toHaveLength(1)
  expect((await readFile(path.join(parent, directories[0], 'input.docx'))).equals(buffer)).toBe(true)
  })
